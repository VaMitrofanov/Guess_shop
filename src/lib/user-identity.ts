import { Prisma, UserIdentityProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type VerifiedIdentityProfile = {
  name?: string | null;
  image?: string | null;
};

export type VerifiedIdentityInput = VerifiedIdentityProfile & {
  provider: UserIdentityProvider;
  subject: string;
};

function normalizeSubject(provider: UserIdentityProvider, subject: string): string {
  const normalized = provider === "EMAIL" ? subject.trim().toLowerCase() : subject.trim();
  if (!normalized) throw new Error("Verified identity subject must not be empty");
  return normalized;
}

function legacyLookup(
  provider: UserIdentityProvider,
  subject: string,
): Prisma.UserWhereInput {
  switch (provider) {
    case "TG":
      return { tgId: subject };
    case "VK":
      return { vkId: subject };
    case "EMAIL":
      return { email: subject };
  }
}

function legacyCreateData(
  provider: UserIdentityProvider,
  subject: string,
): Prisma.UserCreateInput {
  switch (provider) {
    case "TG":
      return { tgId: subject, role: "USER", balance: 0 };
    case "VK":
      return { vkId: subject, role: "USER", balance: 0 };
    case "EMAIL":
      return { email: subject, role: "USER", balance: 0 };
  }
}

function profileUpdate(profile: VerifiedIdentityProfile): Prisma.UserUpdateInput {
  return {
    ...(profile.name ? { name: profile.name } : {}),
    ...(profile.image ? { image: profile.image } : {}),
  };
}

function profileCreate(profile: VerifiedIdentityProfile): Pick<Prisma.UserCreateInput, "name" | "image"> {
  return {
    ...(profile.name ? { name: profile.name } : {}),
    ...(profile.image ? { image: profile.image } : {}),
  };
}

/**
 * Resolves a subject that the provider has already verified on the server.
 *
 * The legacy platform columns are deliberately retained while bots migrate,
 * so a first web login for an existing bot customer gets the exact same User
 * and therefore their orders and bonus balance. This helper never performs a
 * profile merge: conflicting verified identities fail closed for the later
 * step-up merge flow.
 */
export async function findOrCreateVerifiedIdentity(input: VerifiedIdentityInput) {
  const subject = normalizeSubject(input.provider, input.subject);
  const profile = { name: input.name, image: input.image };

  // A simultaneous first login can race on either unique identity key. Retry
  // once by reading the winner; never create a second User for the same ID.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const identity = await tx.userIdentity.findUnique({
          where: { provider_subject: { provider: input.provider, subject } },
          include: { user: true },
        });

        if (identity) {
          const update = profileUpdate(profile);
          const user = Object.keys(update).length > 0
            ? await tx.user.update({ where: { id: identity.userId }, data: update })
            : identity.user;
          await tx.userIdentity.update({
            where: { id: identity.id },
            data: { verifiedAt: new Date() },
          });
          return user;
        }

        const legacyUser = await tx.user.findFirst({
          where: legacyLookup(input.provider, subject),
        });

        if (legacyUser) {
          const providerAlreadyLinked = await tx.userIdentity.findFirst({
            where: { userId: legacyUser.id, provider: input.provider },
          });
          if (providerAlreadyLinked) {
            throw new Error("Identity provider is already linked to a different subject");
          }

          await tx.userIdentity.create({
            data: { provider: input.provider, subject, userId: legacyUser.id },
          });
          const update = profileUpdate(profile);
          return Object.keys(update).length > 0
            ? tx.user.update({ where: { id: legacyUser.id }, data: update })
            : legacyUser;
        }

        const user = await tx.user.create({
          data: { ...legacyCreateData(input.provider, subject), ...profileCreate(profile) },
        });
        await tx.userIdentity.create({
          data: { provider: input.provider, subject, userId: user.id },
        });
        return user;
      });
    } catch (error) {
      if (attempt === 0 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Identity resolution exhausted its retry budget");
}

function laterDate(a: Date | null, b: Date | null) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Links a freshly verified provider to the freshly authenticated web account.
 * If the provider already owns a legacy profile, that profile is merged into
 * the current one inside one serializable transaction and retained as an
 * inert audit anchor. No match by email, display name or Roblox nick is used.
 */
export async function linkOrMergeVerifiedIdentity(targetUserId: string, input: VerifiedIdentityInput) {
  const subject = normalizeSubject(input.provider, input.subject);
  return prisma.$transaction(async (tx) => {
    const [target, identity] = await Promise.all([
      tx.user.findUnique({ where: { id: targetUserId }, include: { identities: true } }),
      tx.userIdentity.findUnique({ where: { provider_subject: { provider: input.provider, subject } }, include: { user: true } }),
    ]);
    if (!target) throw new Error("Target user not found");
    if (target.role === "ADMIN") throw new Error("Privileged accounts cannot be merged");

    const targetProvider = target.identities.find((item) => item.provider === input.provider);
    if (targetProvider && targetProvider.subject !== subject) throw new Error("Provider already linked to another subject");
    if (identity?.userId === target.id || targetProvider?.subject === subject) {
      await tx.userIdentity.update({ where: { id: (identity ?? targetProvider)!.id }, data: { verifiedAt: new Date() } });
      return { userId: target.id, merged: false, alreadyLinked: true };
    }

    if (!identity) {
      await tx.userIdentity.create({ data: { provider: input.provider, subject, userId: target.id } });
      await tx.user.update({
        where: { id: target.id },
        data: {
          ...profileUpdate(input),
          ...(input.provider === "TG" ? { tgId: subject } : input.provider === "VK" ? { vkId: subject } : { email: subject }),
        },
      });
      return { userId: target.id, merged: false, alreadyLinked: false };
    }

    const source = identity.user;
    if (source.role === "ADMIN") throw new Error("Privileged accounts cannot be merged");
    const sourceIdentities = await tx.userIdentity.findMany({ where: { userId: source.id } });
    const overlapping = sourceIdentities.find((item) => target.identities.some((targetItem) => targetItem.provider === item.provider));
    if (overlapping) throw new Error(`Both profiles already have ${overlapping.provider} identities`);

    const audit = await tx.accountMergeAudit.create({
      data: {
        sourceUserId: source.id,
        targetUserId: target.id,
        status: "PROCESSING",
        evidence: {
          method: "dual-fresh-auth",
          currentSessionUserId: target.id,
          linkedProvider: input.provider,
          sourceProviders: sourceIdentities.map((item) => item.provider),
          targetProviders: target.identities.map((item) => item.provider),
        },
      },
    });

    await Promise.all([
      tx.wbCode.updateMany({ where: { userId: source.id }, data: { userId: target.id } }),
      tx.wbOrder.updateMany({ where: { userId: source.id }, data: { userId: target.id } }),
      tx.directIntent.updateMany({ where: { userId: source.id }, data: { userId: target.id } }),
      tx.userIdentity.updateMany({ where: { userId: source.id }, data: { userId: target.id, verifiedAt: new Date() } }),
      tx.priceQuote.updateMany({ where: { userId: source.id, status: "ACTIVE" }, data: { status: "VOID" } }),
    ]);

    const mergedBalance = target.balance + source.balance;
    if (source.balance !== 0) {
      await tx.bonusLedger.create({
        data: {
          userId: target.id,
          deltaRobux: source.balance,
          balanceAfter: mergedBalance,
          reason: "ACCOUNT_MERGE",
          referenceId: audit.id,
          idempotencyKey: `account-merge:${audit.id}:bonus`,
          metadata: { sourceUserId: source.id },
        },
      });
    }
    // Release legacy unique keys before assigning them to the target.
    await tx.user.update({
      where: { id: source.id },
      data: { tgId: null, vkId: null, email: null, password: null, balance: 0, rubleDiscount: 0, bonusExpiresAt: null, promoExpiresAt: null },
    });
    await tx.user.update({
      where: { id: target.id },
      data: {
        balance: mergedBalance,
        bonusExpiresAt: laterDate(target.bonusExpiresAt, source.bonusExpiresAt),
        rubleDiscount: Math.max(target.rubleDiscount, source.rubleDiscount),
        promoExpiresAt: laterDate(target.promoExpiresAt, source.promoExpiresAt),
        robloxUsername: target.robloxUsername ?? source.robloxUsername,
        ...profileUpdate(input),
        ...(input.provider === "TG" ? { tgId: subject } : input.provider === "VK" ? { vkId: subject } : { email: subject }),
      },
    });
    await tx.accountMergeAudit.update({
      where: { id: audit.id },
      data: {
        status: "COMPLETED",
        result: { movedOrders: true, movedIdentities: sourceIdentities.length, transferredBonusRobux: source.balance },
      },
    });
    return { userId: target.id, merged: true, alreadyLinked: false, auditId: audit.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
