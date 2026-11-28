import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";
import {
  GIFT_MESSAGE_MAX,
  GIFT_NAME_MAX,
  GIFT_THEME_META,
  cleanGiftText,
  giftOpenTokenFor,
  giftTextHasLink,
  hashGiftToken,
  isGiftTheme,
  type GiftTheme,
} from "@/lib/codes/gift";
import { buildGiftEmail, escapeHtml } from "@/lib/codes/delivery";

/* 🎁 Подарить УЖЕ купленный код (19.11.2026).

   В кабинете у выданного кода — «Подарить»: открытка (тема, кому, от кого,
   пожелание) и способ — ссылкой (даритель сам шлёт её в мессенджер) или
   письмом на почту получателя. Заказ остаётся тем же (ACCOUNT/EMAIL), меняются
   только поля `gift*` и токен получателя.

   Токен — HMAC от id заказа И случайной соли из события `GIFT_SHARED`:
   «Вернуть себе» стирает хеш, и старая ссылка умирает насовсем, а повторный
   подарок получает НОВУЮ ссылку. Соль живёт в событии, поэтому кабинет может
   показать ссылку ещё раз (в базе по-прежнему только sha256 токена).

   После того как получатель открыл подарок (`giftOpenedAt`), вернуть его
   нельзя: код уже у него. */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://robloxbank.ru";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type ShareMethod = "link" | "email";

export type ShareInput = {
  theme: GiftTheme;
  to: string | null;
  from: string | null;
  message: string | null;
  method: ShareMethod;
  email: string | null;
};

export function validateShare(raw: Record<string, unknown>): { ok: true; input: ShareInput } | { ok: false; error: string } {
  if (!isGiftTheme(raw.theme)) return { ok: false, error: "Выберите открытку." };
  const method: ShareMethod = raw.method === "email" ? "email" : "link";
  let email: string | null = null;
  if (method === "email") {
    email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, error: "Проверьте почту получателя — в ней ошибка." };
  }
  const to = cleanGiftText(typeof raw.to === "string" ? raw.to : null, GIFT_NAME_MAX);
  const from = cleanGiftText(typeof raw.from === "string" ? raw.from : null, GIFT_NAME_MAX);
  const rawMessage = typeof raw.message === "string" ? raw.message : "";
  if (rawMessage.trim().length > GIFT_MESSAGE_MAX) return { ok: false, error: `Пожелание — до ${GIFT_MESSAGE_MAX} символов.` };
  const message = cleanGiftText(rawMessage, GIFT_MESSAGE_MAX);
  for (const value of [to, from, message]) {
    // Ссылкой открытку шлёт сам даритель, но страница открытки — наш домен:
    // правило «без ссылок» то же, что у письма.
    if (value && giftTextHasLink(value)) return { ok: false, error: "В открытке нельзя ссылки и @ники — так её примут за мошенническую." };
  }
  return { ok: true, input: { theme: raw.theme, to, from, message, method, email } };
}

function tokenSecret(): string {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for gift links");
  return secret;
}

/** Токен ссылки подарка из кабинета: 43 символа, как у v1 (`isGiftTokenShape`). */
export function sharedGiftTokenFor(orderId: string, nonce: string): string {
  return crypto.createHmac("sha256", tokenSecret()).update(`code-gift-open:v2:${orderId}:${nonce}`).digest("base64url");
}

export function giftUrl(token: string): string {
  return `${APP_URL}/gift/${token}`;
}

export type ShareResult =
  | { ok: true; url: string; emailed: boolean | null }
  | { ok: false; status: number; error: string };

/** Подарить выданный код. Повторный вызов до открытия заменяет открытку и ссылку. */
export async function shareIssuedCode(userId: string, publicId: string, input: ShareInput): Promise<ShareResult> {
  const order = await prisma.codeOrder.findFirst({
    where: { publicId, creatorUserId: userId },
    select: { id: true, status: true, deliveryMode: true, activationCodeId: true, giftOpenedAt: true, giftOpenTokenHash: true, denomination: true },
  });
  if (!order) return { ok: false, status: 404, error: "Код не найден." };
  if (order.status !== "ISSUED" || !order.activationCodeId) return { ok: false, status: 409, error: "Подарить можно только выданный код." };
  if (order.deliveryMode === "GIFT") return { ok: false, status: 409, error: "Это уже подарок — ссылка на него есть в карточке кода." };
  if (order.giftOpenTokenHash && order.giftOpenedAt) return { ok: false, status: 409, error: "Получатель уже открыл этот подарок." };

  const nonce = crypto.randomBytes(12).toString("base64url");
  const token = sharedGiftTokenFor(order.id, nonce);
  const url = giftUrl(token);
  await prisma.codeOrder.update({
    where: { id: order.id },
    data: {
      giftTheme: input.theme,
      giftTo: input.to,
      giftFrom: input.from,
      giftMessage: input.message,
      giftSendAt: null,
      giftSentAt: null,
      giftOpenedAt: null,
      giftOpenTokenHash: hashGiftToken(token),
    },
  });
  await prisma.codeOrderEvent.create({
    data: {
      orderId: order.id,
      type: "GIFT_SHARED",
      idempotencyKey: `code-gift-share:${order.id}:${nonce}`,
      payload: { nonce, method: input.method, ...(input.email ? { email: input.email } : {}) },
    },
  });

  let emailed: boolean | null = null;
  if (input.method === "email" && input.email) {
    const mail = buildGiftEmail({ denomination: order.denomination, theme: input.theme, to: input.to, from: input.from, message: input.message, openUrl: url });
    const result = await sendMail({ to: input.email, ...mail });
    emailed = result.ok;
    if (result.ok) await prisma.codeOrder.update({ where: { id: order.id }, data: { giftSentAt: new Date() } });
    await prisma.codeOrderEvent.create({
      data: {
        orderId: order.id,
        type: result.ok ? "GIFT_EMAIL_SENT" : "GIFT_EMAIL_FAILED",
        idempotencyKey: `code-gift-share-email:${order.id}:${nonce}`,
        payload: { reason: "share", ...(result.ok ? {} : { error: result.reason }) },
      },
    }).catch(() => undefined);
  }
  return { ok: true, url, emailed };
}

/** «Вернуть себе»: ссылка перестаёт работать, код снова только у владельца. */
export async function revokeSharedGift(userId: string, publicId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const order = await prisma.codeOrder.findFirst({
    where: { publicId, creatorUserId: userId },
    select: { id: true, deliveryMode: true, giftOpenTokenHash: true, giftOpenedAt: true },
  });
  if (!order || !order.giftOpenTokenHash || order.deliveryMode === "GIFT") return { ok: false, status: 404, error: "Подарок не найден." };
  if (order.giftOpenedAt) return { ok: false, status: 409, error: "Получатель уже открыл подарок — вернуть его нельзя." };
  await prisma.codeOrder.update({
    where: { id: order.id },
    data: { giftOpenTokenHash: null, giftTheme: null, giftTo: null, giftFrom: null, giftMessage: null, giftSentAt: null },
  });
  await prisma.codeOrderEvent.create({
    data: { orderId: order.id, type: "GIFT_SHARE_REVOKED", idempotencyKey: `code-gift-revoke:${order.id}:${Date.now()}`, payload: {} },
  }).catch(() => undefined);
  return { ok: true };
}

/**
 * Ссылки на подарки для кабинета. У подарка при покупке — v1-токен от id; у
 * подарка из кабинета — соль из последнего `GIFT_SHARED`, сверенная с хешем
 * (после «Вернуть себе» хеша нет — и ссылки нет).
 */
export async function giftLinksFor(orders: { id: string; deliveryMode: string; giftOpenTokenHash: string | null }[]): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  const shared: typeof orders = [];
  for (const order of orders) {
    if (!order.giftOpenTokenHash) continue;
    if (order.deliveryMode === "GIFT") {
      const token = giftOpenTokenFor(order.id);
      if (hashGiftToken(token) === order.giftOpenTokenHash) links.set(order.id, giftUrl(token));
    } else {
      shared.push(order);
    }
  }
  if (shared.length === 0) return links;
  const events = await prisma.codeOrderEvent.findMany({
    where: { orderId: { in: shared.map((order) => order.id) }, type: "GIFT_SHARED" },
    orderBy: { createdAt: "desc" },
    select: { orderId: true, payload: true },
  });
  for (const order of shared) {
    for (const event of events) {
      if (event.orderId !== order.id) continue;
      const nonce = (event.payload as { nonce?: unknown } | null)?.nonce;
      if (typeof nonce !== "string") continue;
      const token = sharedGiftTokenFor(order.id, nonce);
      if (hashGiftToken(token) === order.giftOpenTokenHash) {
        links.set(order.id, giftUrl(token));
        break;
      }
    }
  }
  return links;
}

// ─── «Спасибо» дарителю ──────────────────────────────────────────────────────

/** Куда писать дарителю: почта чека, иначе подтверждённая почта аккаунта. */
export function giverEmail(order: {
  payments: { receiptEmail: string | null }[];
  creator: { email: string | null; emailVerifiedAt: Date | null } | null;
}): string | null {
  const receipt = order.payments.find((payment) => payment.receiptEmail)?.receiptEmail ?? null;
  if (receipt) return receipt;
  return order.creator?.email && order.creator.emailVerifiedAt ? order.creator.email : null;
}

export function buildThanksEmail(input: { denomination: number; theme: GiftTheme; to: string | null }): { subject: string; text: string; html: string } {
  const amount = input.denomination.toLocaleString("ru-RU");
  const meta = GIFT_THEME_META[input.theme];
  const who = input.to ? `Подарок (${input.to})` : "Ваш подарок";
  const subject = `♥ ${who} открыт — вам спасибо!`;
  const text = [
    `${who} на ${amount} Robux открыт, и вам передают спасибо ♥`,
    "",
    "Открытка дошла и понравилась.",
    "",
    `P.S. Захотите порадовать ещё кого-то — открытки живут тут: ${APP_URL}/#gift`,
  ].join("\n");
  const esc = escapeHtml;
  const html = `<!doctype html><html lang="ru"><body style="margin:0;background:#f4f5fb;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#151827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:22px;overflow:hidden">
<tr><td style="padding:30px 26px;background:linear-gradient(160deg,${meta.from},${meta.to});color:#ffffff;text-align:center">
<p style="margin:0;font-size:40px;line-height:1">♥</p>
<h1 style="margin:12px 0 0;font-size:24px;line-height:1.25">${esc(who)} открыт</h1>
<p style="margin:8px 0 0;font-size:15px;color:${meta.ink}">${amount} Robux — и вам передают спасибо</p>
</td></tr>
<tr><td style="padding:22px 26px 26px">
<p style="margin:0;font-size:16px;line-height:1.55">Открытка дошла и понравилась — получатель нажал «спасибо» прямо на ней.</p>
<p style="margin:18px 0 0;font-size:14px;line-height:1.5;color:#6b6f86">P.S. Захотите порадовать ещё кого-то — <a href="${APP_URL}/#gift" style="color:#7c5cff;font-weight:700">открытки живут тут</a>.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

/** Получатель нажал сердечко. Одно спасибо на подарок; письмо дарителю — одно. */
export async function thankGiver(token: string): Promise<{ ok: true; already: boolean } | { ok: false; status: number; error: string }> {
  const order = await prisma.codeOrder.findUnique({
    where: { giftOpenTokenHash: hashGiftToken(token) },
    select: {
      id: true, denomination: true, giftTheme: true, giftTo: true, giftOpenedAt: true,
      creator: { select: { email: true, emailVerifiedAt: true } },
      payments: { where: { status: "CONFIRMED" }, select: { receiptEmail: true }, take: 1 },
    },
  });
  if (!order) return { ok: false, status: 404, error: "Подарок не найден." };
  if (!order.giftOpenedAt) return { ok: false, status: 409, error: "Сначала откройте подарок." };
  try {
    await prisma.codeOrderEvent.create({
      data: { orderId: order.id, type: "GIFT_THANKS", idempotencyKey: `code-gift-thanks:${order.id}`, payload: {} },
    });
  } catch {
    return { ok: true, already: true };
  }
  const to = giverEmail(order);
  if (to) {
    const theme = isGiftTheme(order.giftTheme) ? order.giftTheme : "JUST";
    const result = await sendMail({ to, ...buildThanksEmail({ denomination: order.denomination, theme, to: order.giftTo }) });
    if (!result.ok) console.warn("[codes] gift thanks email failed", { orderId: order.id, reason: result.reason });
  }
  return { ok: true, already: false };
}

/** Можно ли благодарить и уже поблагодарили ли — для страницы подарка. */
export async function thanksState(orderId: string): Promise<boolean> {
  const event = await prisma.codeOrderEvent.findFirst({ where: { orderId, type: "GIFT_THANKS" }, select: { id: true } });
  return Boolean(event);
}
