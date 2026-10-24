import crypto from "crypto";
import { EmailActionPurpose } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendMail, type SendResult } from "@/lib/mailer";

export const PRIVACY_POLICY_VERSION = "2026-07-18";
export const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1_000;
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1_000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type ConsumeEmailTokenResult = "success" | "invalid" | "expired" | "conflict";

function emailHtml(input: { preheader: string; title: string; body: string; link: string; button: string; note: string }) {
  return `<!doctype html><html lang="ru"><body style="margin:0;background:#f6f3ff;font-family:Arial,sans-serif;color:#241b43"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${input.preheader}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;background:#f6f3ff"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e4ddfa;border-radius:20px"><tr><td style="padding:32px"><p style="margin:0 0 22px;font-size:18px;font-weight:700;color:#7050e8">RobloxBank</p><h1 style="margin:0 0 14px;font-size:28px;line-height:1.15">${input.title}</h1><p style="margin:0 0 26px;font-size:16px;line-height:1.55;color:#6f6784">${input.body}</p><p style="margin:0 0 26px"><a href="${input.link}" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#7352e8;color:#fff;text-decoration:none;font-weight:700">${input.button}</a></p><p style="margin:0;font-size:13px;line-height:1.55;color:#8b839f">${input.note}</p><p style="margin:22px 0 0;font-size:12px;line-height:1.5;color:#8b839f">Если кнопка не работает, откройте ссылку:<br><a href="${input.link}" style="color:#7050e8;word-break:break-all">${input.link}</a></p></td></tr></table></td></tr></table></body></html>`;
}

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

export function publicAppOrigin(candidate = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? process.env.NEXTAUTH_URL) {
  try {
    const parsed = new URL(candidate ?? "https://robloxbank.ru");
    const localHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
    const publicHost = parsed.hostname === "robloxbank.ru" || parsed.hostname === "www.robloxbank.ru";
    if (!publicHost && !(localHost && parsed.protocol === "http:")) {
      return "https://robloxbank.ru";
    }
    return parsed.origin;
  } catch {
    return "https://robloxbank.ru";
  }
}

export function emailVerificationResultUrl(status: ConsumeEmailTokenResult, candidate?: string) {
  const destination = new URL("/email/verified", publicAppOrigin(candidate));
  destination.searchParams.set("status", status);
  return destination;
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
  const link = `${publicAppOrigin()}/api/auth/email/verify?token=${encodeURIComponent(issued.token)}`;
  const result = await sendMail({
    to: email,
    subject: "Подтвердите email — RobloxBank",
    text: `Подтвердите email для аккаунта RobloxBank:\n\n${link}\n\nСсылка действует 24 часа. Если это были не вы, просто проигнорируйте письмо.`,
    html: emailHtml({
      preheader: "Подтвердите email, чтобы восстановление доступа всегда было доступно.",
      title: "Подтвердите email",
      body: "Нажмите кнопку ниже, чтобы подтвердить адрес для аккаунта RobloxBank.",
      link,
      button: "Подтвердить email",
      note: "Ссылка действует 24 часа. Если это были не вы, просто проигнорируйте письмо.",
    }),
  });
  if (!result.ok) await invalidateUndeliveredToken(issued.tokenHash);
  return result;
}

export async function sendPasswordResetEmail(userId: string, email: string): Promise<SendResult> {
  const issued = await issueEmailActionToken(userId, EmailActionPurpose.RESET_PASSWORD);
  const link = `${publicAppOrigin()}/reset-password?token=${encodeURIComponent(issued.token)}`;
  const result = await sendMail({
    to: email,
    subject: "Восстановление доступа — RobloxBank",
    text: `Чтобы задать новый пароль RobloxBank, откройте ссылку:\n\n${link}\n\nСсылка действует 30 минут и используется один раз. Если это были не вы, ничего делать не нужно.`,
    html: emailHtml({
      preheader: "Ссылка для восстановления доступа к RobloxBank.",
      title: "Восстановление доступа",
      body: "Нажмите кнопку ниже, чтобы задать новый пароль RobloxBank.",
      link,
      button: "Задать новый пароль",
      note: "Ссылка действует 30 минут и используется один раз. Если это были не вы, ничего делать не нужно.",
    }),
  });
  if (!result.ok) await invalidateUndeliveredToken(issued.tokenHash);
  return result;
}

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
