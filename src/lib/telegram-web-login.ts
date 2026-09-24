import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export type TelegramWebLoginMode = "login" | "link";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function telegramWebLoginStateHash(state: string): string {
  return crypto.createHash("sha256").update(state).digest("hex");
}

export function telegramWebLoginStartPayload(mode: TelegramWebLoginMode, state: string): string {
  return `web_${mode}_${state}`;
}

export async function issueTelegramWebLoginChallenge(
  mode: TelegramWebLoginMode,
  targetUserId: string | null,
  now = new Date(),
) {
  const state = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);

  await prisma.$transaction([
    prisma.telegramWebLoginChallenge.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - 60 * 60 * 1000) } },
    }),
    prisma.telegramWebLoginChallenge.create({
      data: {
        stateHash: telegramWebLoginStateHash(state),
        mode,
        targetUserId,
        expiresAt,
      },
    }),
  ]);

  return { state, expiresAt };
}

export async function consumeTelegramWebLoginChallenge(
  state: string,
  mode: TelegramWebLoginMode,
  now = new Date(),
) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(state)) return null;
  const stateHash = telegramWebLoginStateHash(state);

  return prisma.$transaction(async (tx) => {
    const challenge = await tx.telegramWebLoginChallenge.findUnique({ where: { stateHash } });
    if (
      !challenge ||
      challenge.mode !== mode ||
      challenge.consumedAt ||
      challenge.expiresAt <= now
    ) {
      return null;
    }

    const consumed = await tx.telegramWebLoginChallenge.updateMany({
      where: { stateHash, consumedAt: null, expiresAt: { gt: now }, mode },
      data: { consumedAt: now },
    });
    return consumed.count === 1 ? challenge : null;
  });
}
