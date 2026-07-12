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
