import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  legacyCreateData,
  legacyLookup,
  linkOrMergeVerifiedIdentity as linkOrMergeWith,
  normalizeSubject,
  profileCreate,
  profileUpdate,
  type MergeMethod,
  type VerifiedIdentityInput,
  type VerifiedIdentityProfile,
} from "../../bots/shared/account-merge";

/* Ядро слияния живёт в `bots/shared/account-merge.ts`: те же правила нужны
   ботам, а боты не видят `src/`. Здесь остаётся веб-обёртка, подставляющая
   `prisma`, и резолвер первой авторизации. */

export type { VerifiedIdentityInput, VerifiedIdentityProfile };

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

/**
 * Links a freshly verified provider to the freshly authenticated web account.
 * If the provider already owns a legacy profile, that profile is merged into
 * the current one inside one serializable transaction and retained as an
 * inert audit anchor. No match by email, display name or Roblox nick is used.
 */
export async function linkOrMergeVerifiedIdentity(
  targetUserId: string,
  input: VerifiedIdentityInput,
  method: MergeMethod = "dual-fresh-auth",
) {
  return linkOrMergeWith(prisma, targetUserId, input, method);
}
