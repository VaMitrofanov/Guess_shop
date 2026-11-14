import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { CODE_SIGNUP_DISCOUNT_PERCENT, codeDiscountPercent, codeDiscountProgress, type CodeDiscountProgress } from "@/lib/codes-pricing";
import { channelSubscription, type SubscriptionCheck } from "@/lib/codes/subscription";

/**
 * Программа приглашений для кодов активации.
 *
 * Правила (владелец, 14.11.2026):
 * - засчитывается уникальный приглашённый, который зарегистрировался ПО ССЫЛКЕ
 *   и впервые успешно оплатил и получил заказ кода;
 * - регистрация без покупки, повторные заказы того же человека, самоприглашение,
 *   отменённые и возвращённые заказы — не считаются;
 * - прогресс накопительный.
 *
 * Счётчик не хранится, а считается по заказам (`countQualifiedInvites`): так
 * повторное уведомление банка не может «добавить» приглашённого второй раз, а
 * возврат денег сам убирает его из счёта.
 */

export const REFERRAL_COOKIE = "rb_ref";
export const REFERRAL_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;
/** Аккаунт старше куки на это время — не «пришёл по ссылке», а уже был. */
const ACCOUNT_AGE_TOLERANCE_MS = 10 * 60 * 1000;

const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function isReferralCodeShape(code: unknown): code is string {
  return typeof code === "string" && /^[a-z0-9]{6,12}$/.test(code);
}

function cookieSecret(): string {
  return process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", cookieSecret()).update(`ref:v1:${payload}`).digest("base64url").slice(0, 22);
}

/** Подписанная кука: код ссылки + момент перехода (подделать время нельзя). */
export function buildReferralCookie(code: string, now = Date.now()): string {
  const payload = `${code}.${now}`;
  return `${payload}.${sign(payload)}`;
}

export function parseReferralCookie(value: string | undefined | null): { code: string; at: number } | null {
  if (!value || !cookieSecret()) return null;
  const [code, at, sig] = value.split(".");
  if (!isReferralCodeShape(code) || !/^\d{10,16}$/.test(at ?? "") || !sig) return null;
  const expected = sign(`${code}.${at}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { code, at: Number(at) };
}

function randomReferralCode(): string {
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (const byte of bytes) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return out;
}

/** Код ссылки выдаётся лениво и навсегда. */
export async function ensureReferralCode(userId: string): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
  if (existing?.referralCode) return existing.referralCode;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomReferralCode();
    const updated = await prisma.user.updateMany({ where: { id: userId, referralCode: null }, data: { referralCode: code } })
      .catch(() => ({ count: 0 }));
    if (updated.count === 1) return code;
    const again = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
    if (again?.referralCode) return again.referralCode;
  }
  throw new Error("Unable to allocate referral code");
}

export type ReferralClaimResult = "attached" | "already" | "self" | "not_new" | "unknown_code" | "no_cookie";

/**
 * Привязывает НОВЫЙ аккаунт к пригласившему. Ставится один раз и навсегда;
 * аккаунт, созданный раньше перехода по ссылке, «приглашённым» не становится.
 */
export async function claimReferral(userId: string, cookieValue: string | undefined | null): Promise<ReferralClaimResult> {
  const parsed = parseReferralCookie(cookieValue);
  if (!parsed) return "no_cookie";
  return claimReferralCode(userId, parsed);
}

/**
 * То же правило без куки — для ботов (`/start r_<код>`, 15.11.2026): момент
 * перехода — момент, когда бот получил команду, его подделать нельзя.
 */
export async function claimReferralCode(userId: string, parsed: { code: string; at: number }): Promise<ReferralClaimResult> {
  if (!isReferralCodeShape(parsed.code)) return "unknown_code";
  const [user, referrer] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, referredById: true, createdAt: true, referralCode: true } }),
    prisma.user.findUnique({ where: { referralCode: parsed.code }, select: { id: true } }),
  ]);
  if (!user) return "no_cookie";
  if (user.referredById) return "already";
  if (!referrer) return "unknown_code";
  if (referrer.id === user.id || user.referralCode === parsed.code) return "self";
  if (user.createdAt.getTime() < parsed.at - ACCOUNT_AGE_TOLERANCE_MS) return "not_new";
  // Уже покупал коды до привязки — это не «первая покупка по приглашению».
  const paidBefore = await prisma.codeOrder.count({ where: { creatorUserId: userId, paidAt: { not: null } } });
  if (paidBefore > 0) return "not_new";
  const updated = await prisma.user.updateMany({
    where: { id: userId, referredById: null },
    data: { referredById: referrer.id, referredAt: new Date() },
  });
  return updated.count === 1 ? "attached" : "already";
}

/**
 * Засчитанные приглашённые: разные люди, пришедшие по ссылке, у которых есть
 * выданный и не возвращённый заказ кода, оплаченный после привязки.
 */
export async function countQualifiedInvites(referrerId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT u.id)::bigint AS n
    FROM "User" u
    JOIN "CodeOrder" o ON o."creatorUserId" = u.id
    WHERE u."referredById" = ${referrerId}
      AND u.id <> ${referrerId}
      AND o.status = 'ISSUED'
      AND o."refundedAt" IS NULL
      AND o."paidAt" IS NOT NULL
      AND (u."referredAt" IS NULL OR o."paidAt" >= u."referredAt")
  `;
  return Number(rows[0]?.n ?? 0);
}

export interface ViewerDiscount {
  registered: boolean;
  percent: number;
  invitedCount: number;
  progress: CodeDiscountProgress | null;
  /** Подписан ли на канал/группу и чем это можно проверить. */
  subscription: SubscriptionCheck | null;
}

/**
 * Базовый 1 % — регистрация + подписка на канал (15.11.2026). Уровни за
 * друзей (2–5 %) от подписки не зависят: их человек заработал приглашениями.
 */
export function discountWithSubscription(invitedCount: number, subscribed: boolean): number {
  const percent = codeDiscountPercent({ registered: true, invitedCount });
  return percent <= CODE_SIGNUP_DISCOUNT_PERCENT && !subscribed ? 0 : percent;
}

export async function viewerCodeDiscount(userId: string | null | undefined, opts: { forceSubscriptionCheck?: boolean } = {}): Promise<ViewerDiscount> {
  if (!userId) return { registered: false, percent: 0, invitedCount: 0, progress: null, subscription: null };
  const [invitedCount, subscription] = await Promise.all([
    countQualifiedInvites(userId),
    channelSubscription(userId, { force: opts.forceSubscriptionCheck }),
  ]);
  return {
    registered: true,
    percent: discountWithSubscription(invitedCount, subscription.subscribed),
    invitedCount,
    progress: codeDiscountProgress(invitedCount),
    subscription,
  };
}

/** «покупатель / покупателя / покупателей». */
export function buyersWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "покупатель";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "покупателя";
  return "покупателей";
}
