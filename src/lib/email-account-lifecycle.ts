import crypto from "crypto";
import { EmailActionPurpose } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendMail, type SendResult } from "@/lib/mailer";

export const PRIVACY_POLICY_VERSION = "2026-07-18";
export const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1_000;
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1_000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function emailActionTokenHash(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function isEmailActionToken(value: string) {
  return TOKEN_PATTERN.test(value);
}

export function consentIpHash(ip: string, secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET) {
  if (!secret || !ip || ip === "unknown") return null;
  return crypto.createHmac("sha256", secret).update(ip, "utf8").digest("hex");
}

function publicBaseUrl() {
  const candidate = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  try {
    const parsed = new URL(candidate ?? "https://robloxbank.ru");
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      return "https://robloxbank.ru";
    }
    return parsed.origin;
  } catch {
    return "https://robloxbank.ru";
  }
}

function ttlFor(purpose: EmailActionPurpose) {
  return purpose === EmailActionPurpose.VERIFY_EMAIL ? EMAIL_VERIFY_TTL_MS : PASSWORD_RESET_TTL_MS;
}

export async function issueEmailActionToken(userId: string, purpose: EmailActionPurpose, now = new Date()) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = emailActionTokenHash(token);
  const expiresAt = new Date(now.getTime() + ttlFor(purpose));

  await prisma.$transaction(async (tx) => {
    await tx.emailActionToken.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: now },
    });
    await tx.emailActionToken.create({ data: { userId, purpose, tokenHash, expiresAt } });
  });

  return { token, tokenHash, expiresAt };
}

async function invalidateUndeliveredToken(tokenHash: string) {
  await prisma.emailActionToken.updateMany({
    where: { tokenHash, consumedAt: null },
    data: { consumedAt: new Date() },
  });
}

export async function sendVerificationEmail(userId: string, email: string): Promise<SendResult> {
  const issued = await issueEmailActionToken(userId, EmailActionPurpose.VERIFY_EMAIL);
  const link = `${publicBaseUrl()}/api/auth/email/verify?token=${encodeURIComponent(issued.token)}`;
  const result = await sendMail({
    to: email,
    subject: "Подтвердите email — RobloxBank",
    text: `Подтвердите email для аккаунта RobloxBank: ${link}\n\nСсылка действует 24 часа. Если это были не вы, просто проигнорируйте письмо.`,
    html: `<p>Подтвердите email для аккаунта RobloxBank.</p><p><a href="${link}">Подтвердить email</a></p><p>Ссылка действует 24 часа. Если это были не вы, просто проигнорируйте письмо.</p>`,
  });
  if (!result.ok) await invalidateUndeliveredToken(issued.tokenHash);
  return result;
}

export async function sendPasswordResetEmail(userId: string, email: string): Promise<SendResult> {
  const issued = await issueEmailActionToken(userId, EmailActionPurpose.RESET_PASSWORD);
  const link = `${publicBaseUrl()}/reset-password?token=${encodeURIComponent(issued.token)}`;
  const result = await sendMail({
    to: email,
    subject: "Восстановление доступа — RobloxBank",
    text: `Чтобы задать новый пароль RobloxBank, откройте ссылку: ${link}\n\nСсылка действует 30 минут и используется один раз. Если это были не вы, ничего делать не нужно.`,
    html: `<p>Чтобы задать новый пароль RobloxBank, откройте ссылку:</p><p><a href="${link}">Задать новый пароль</a></p><p>Ссылка действует 30 минут и используется один раз. Если это были не вы, ничего делать не нужно.</p>`,
  });
  if (!result.ok) await invalidateUndeliveredToken(issued.tokenHash);
  return result;
}

export type ConsumeEmailTokenResult = "success" | "invalid" | "expired" | "conflict";

export async function verifyEmailActionToken(rawToken: string, now = new Date()): Promise<ConsumeEmailTokenResult> {
  if (!isEmailActionToken(rawToken)) return "invalid";
  const tokenHash = emailActionTokenHash(rawToken);

  return prisma.$transaction(async (tx) => {
    const record = await tx.emailActionToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!record || record.purpose !== EmailActionPurpose.VERIFY_EMAIL || record.consumedAt) return "invalid";
    if (record.expiresAt <= now) return "expired";
    if (!record.user.email) return "invalid";

    const identity = await tx.userIdentity.findUnique({
      where: { provider_subject: { provider: "EMAIL", subject: record.user.email } },
      select: { userId: true },
    });
    if (identity && identity.userId !== record.userId) return "conflict";

    const consumed = await tx.emailActionToken.updateMany({
      where: { id: record.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) return "invalid";

    await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: now } });
    if (!identity) {
      await tx.userIdentity.create({
        data: { provider: "EMAIL", subject: record.user.email, userId: record.userId, verifiedAt: now },
      });
    }
    return "success";
  });
}

export async function resetPasswordWithActionToken(
  rawToken: string,
  passwordHash: string,
  now = new Date(),
): Promise<ConsumeEmailTokenResult> {
  if (!isEmailActionToken(rawToken)) return "invalid";
  const tokenHash = emailActionTokenHash(rawToken);

  return prisma.$transaction(async (tx) => {
    const record = await tx.emailActionToken.findUnique({ where: { tokenHash } });
    if (!record || record.purpose !== EmailActionPurpose.RESET_PASSWORD || record.consumedAt) return "invalid";
    if (record.expiresAt <= now) return "expired";

    const consumed = await tx.emailActionToken.updateMany({
      where: { id: record.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) return "invalid";

    await tx.user.update({
      where: { id: record.userId },
      data: { password: passwordHash, sessionVersion: { increment: 1 } },
    });
    await tx.emailActionToken.updateMany({
      where: { userId: record.userId, consumedAt: null },
      data: { consumedAt: now },
    });
    return "success";
  });
}
