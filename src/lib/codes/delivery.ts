import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";
import { decryptActivationCode } from "@/lib/codes/secrets";
import { GIFT_THEME_META, giftOpenTokenFor, isGiftTheme, type GiftTheme } from "@/lib/codes/gift";
import { sendCodeToChat } from "@/lib/codes/chat-notify";

/**
 * Письмо с кодом активации.
 *
 * Деньги и код не зависят от письма: код закреплён за заказом в той же
 * транзакции, что подтверждает оплату, а письмо — отдельный шаг после неё.
 * Упало — заказ остаётся ISSUED, ошибка пишется в `emailLastError` (без адреса
 * и без кода), и то же письмо с ТЕМ ЖЕ кодом можно отправить повторно.
 *
 * Значение кода не попадает ни в лог, ни в базу открытым текстом.
 */

export const ROBLOX_REDEEM_URL = "https://www.roblox.com/redeem";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://robloxbank.ru";
const MAX_EMAIL_ATTEMPTS = 8;

export const ACTIVATION_STEPS = [
  "Откройте roblox.com/redeem — кнопка «Активировать на Roblox» ниже.",
  "Войдите в тот аккаунт Roblox, на который нужны Robux.",
  "Введите код и нажмите «Активировать» (Redeem).",
  "Robux сразу появятся на балансе этого аккаунта.",
] as const;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildCodeEmail(input: {
  denomination: number;
  code: string;
  publicId: string;
  account: boolean;
}): { subject: string; text: string; html: string } {
  const amount = input.denomination.toLocaleString("ru-RU");
  const subject = `Ваш код на ${amount} Robux — заказ ${input.publicId}`;
  const cabinet = input.account ? `\nКод также сохранён в личном кабинете: ${APP_URL}/dashboard#codes\n` : "";
  const text = [
    `Код активации Roblox на ${amount} Robux`,
    "",
    `Код: ${input.code}`,
    `Заказ: ${input.publicId}`,
    "",
    "Как активировать:",
    ...ACTIVATION_STEPS.map((step, index) => `${index + 1}. ${step}`),
    "",
    `Активировать: ${ROBLOX_REDEEM_URL}`,
    cabinet,
    "Пароль Roblox нам не нужен и никогда не запрашивается. Не передавайте код посторонним: кто ввёл код, тот и получил Robux.",
    "",
    `Поддержка: https://t.me/RobloxBank_PA · ${APP_URL}`,
  ].join("\n");

  const code = escapeHtml(input.code);
  const steps = ACTIVATION_STEPS.map((step) => `<li style="margin:0 0 8px">${escapeHtml(step)}</li>`).join("");
  const html = `<!doctype html><html lang="ru"><body style="margin:0;background:#f4f5fb;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#151827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;padding:28px">
<tr><td>
<p style="margin:0 0 6px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#6b6f86">RobloxBank · заказ ${escapeHtml(input.publicId)}</p>
<h1 style="margin:0 0 18px;font-size:24px;line-height:1.25">Ваш код на ${amount} Robux</h1>
<p style="margin:0 0 8px;font-size:14px;color:#6b6f86">Код активации — нажмите и удерживайте, чтобы скопировать:</p>
<div style="margin:0 0 20px;padding:18px;border:2px dashed #7c5cff;border-radius:14px;background:#f6f3ff;text-align:center;font-family:SFMono-Regular,Menlo,Consolas,monospace;font-size:24px;font-weight:700;letter-spacing:.08em;user-select:all;-webkit-user-select:all">${code}</div>
<a href="${ROBLOX_REDEEM_URL}" style="display:block;text-align:center;background:#7c5cff;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:15px 18px;border-radius:14px">Активировать на Roblox</a>
<h2 style="margin:24px 0 10px;font-size:16px">Как активировать</h2>
<ol style="margin:0;padding-left:20px;font-size:15px;line-height:1.5">${steps}</ol>
${input.account ? `<p style="margin:18px 0 0;font-size:14px">Код сохранён и в <a href="${APP_URL}/dashboard#codes" style="color:#7c5cff">личном кабинете</a>.</p>` : ""}
<p style="margin:18px 0 0;font-size:13px;color:#6b6f86;line-height:1.5">Пароль Roblox нам не нужен и никогда не запрашивается. Не передавайте код посторонним: кто ввёл код, тот и получил Robux.</p>
<p style="margin:12px 0 0;font-size:13px;color:#6b6f86">Поддержка: <a href="https://t.me/RobloxBank_PA" style="color:#7c5cff">@RobloxBank_PA</a></p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

/** Куда слать письмо: гостю — адрес из оформления, клиенту — подтверждённая почта аккаунта. */
async function deliveryAddress(orderId: string) {
  const order = await prisma.codeOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true, publicId: true, denomination: true, status: true, deliveryMode: true, recipientEmail: true, emailAttempts: true,
      activationCode: { select: { encryptedValue: true } },
      creator: { select: { email: true, emailVerifiedAt: true } },
    },
  });
  if (!order) return null;
  const to = order.deliveryMode === "EMAIL" || order.deliveryMode === "GIFT"
    ? order.recipientEmail
    : order.creator?.emailVerifiedAt ? order.creator.email : null;
  return { order, to };
}

export type CodeEmailResult = "sent" | "no_address" | "not_issued" | "failed" | "exhausted" | "scheduled";

/**
 * Отправить (или переотправить) письмо с уже выданным кодом. Новой оплаты и
 * новой выдачи не бывает: код берётся из заказа.
 */
export async function sendCodeEmail(orderId: string, reason: "issued" | "resend" | "scheduled"): Promise<CodeEmailResult> {
  const found = await deliveryAddress(orderId);
  if (!found) return "not_issued";
  const { order, to } = found;
  if (order.status !== "ISSUED" || !order.activationCode) return "not_issued";
  // Подарок — своё письмо-открытка без кода в тексте (`sendGiftEmail`).
  if (order.deliveryMode === "GIFT") return sendGiftEmail(order.id, reason);
  if (!to) return "no_address";
  if (order.emailAttempts >= MAX_EMAIL_ATTEMPTS) return "exhausted";

  let code: string;
  try {
    code = decryptActivationCode(order.activationCode.encryptedValue);
  } catch {
    await prisma.codeOrder.update({ where: { id: order.id }, data: { emailLastError: "decrypt_failed", emailAttempts: { increment: 1 } } });
    console.error("[codes] cannot decrypt issued code", { orderId: order.id });
    return "failed";
  }
  const mail = buildCodeEmail({ denomination: order.denomination, code, publicId: order.publicId, account: order.deliveryMode === "ACCOUNT" });
  const result = await sendMail({ to, ...mail });
  await prisma.codeOrder.update({
    where: { id: order.id },
    data: result.ok
      ? { emailSentAt: new Date(), emailLastError: null, emailAttempts: { increment: 1 } }
      : { emailLastError: result.reason, emailAttempts: { increment: 1 } },
  });
  await prisma.codeOrderEvent.create({
    data: {
      orderId: order.id,
      type: result.ok ? "EMAIL_SENT" : "EMAIL_FAILED",
      idempotencyKey: `code-email:${order.id}:${order.emailAttempts + 1}`,
      payload: { reason, ...(result.ok ? {} : { error: result.reason }) },
    },
  }).catch(() => undefined);
  return result.ok ? "sent" : "failed";
}

// ─── 🎁 Подарок открыткой (15.11.2026) ───────────────────────────────────────

function giftTokenUrl(orderId: string): string {
  return `${APP_URL}/gift/${giftOpenTokenFor(orderId)}`;
}

export function buildGiftEmail(input: {
  denomination: number;
  theme: GiftTheme;
  to: string | null;
  from: string | null;
  message: string | null;
  openUrl: string;
}): { subject: string; text: string; html: string } {
  const meta = GIFT_THEME_META[input.theme];
  const amount = input.denomination.toLocaleString("ru-RU");
  const greeting = meta.greeting(input.to);
  const subject = `🎁 ${greeting} ${amount} Robux в подарок${input.from ? ` от: ${input.from}` : ""}`;
  const text = [
    greeting,
    "",
    `${amount} Robux — ${meta.tagline.toLowerCase()}.`,
    input.message ? `«${input.message}»${input.from ? ` — ${input.from}` : ""}` : input.from ? `От: ${input.from}` : "",
    "",
    `Открыть подарок: ${input.openUrl}`,
    "",
    "По ссылке откроется код и короткая инструкция: зайти на roblox.com/redeem, войти в свой аккаунт, ввести код — Robux сразу на балансе.",
    "Пароль от Roblox никому сообщать не нужно.",
    "",
    `Подарок оформлен в RobloxBank · ${APP_URL}`,
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");

  const esc = escapeHtml;
  const note = input.message
    ? `<div style="margin:0 0 18px;padding:16px;border-radius:14px;background:${meta.note};font-size:16px;line-height:1.5;color:#3a2a3a">«${esc(input.message)}»${input.from ? `<br><b style="font-size:14px">— ${esc(input.from)}</b>` : ""}</div>`
    : input.from
      ? `<p style="margin:0 0 18px;font-size:16px;color:#3a2a3a">От: <b>${esc(input.from)}</b></p>`
      : "";
  const html = `<!doctype html><html lang="ru"><body style="margin:0;background:#f4f5fb;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#151827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:22px;overflow:hidden">
<tr><td style="background:${meta.from};background-image:linear-gradient(165deg,${meta.from},${meta.to});padding:0;text-align:center">
<img src="${APP_URL}${meta.image}" width="520" alt="" style="display:block;width:100%;max-width:520px;height:auto;border:0">
</td></tr>
<tr><td style="background:${meta.from};background-image:linear-gradient(165deg,${meta.from},${meta.to});padding:4px 24px 28px;text-align:center;color:#ffffff">
<p style="margin:0 0 8px;font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${meta.ink}">${esc(greeting)}</p>
<p style="margin:0;font-size:52px;line-height:1;font-weight:800;letter-spacing:-.04em">${amount}</p>
<p style="margin:8px 0 0;font-size:14px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:${meta.ink}">${esc(meta.tagline)}</p>
</td></tr>
<tr><td style="padding:22px 24px 26px">
${note}
<a href="${esc(input.openUrl)}" style="display:block;text-align:center;background:${meta.button};color:#ffffff;text-decoration:none;font-weight:800;font-size:17px;padding:16px 18px;border-radius:14px">Открыть подарок</a>
<p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:#6b6f86;text-align:center">По кнопке откроется код и короткая инструкция: зайти на roblox.com/redeem, ввести код — готово. Пароль от Roblox никому сообщать не нужно.</p>
<p style="margin:18px 0 0;font-size:12px;color:#9a9db0;text-align:center">Подарок оформлен в <a href="${APP_URL}" style="color:#7c5cff">RobloxBank</a> · поддержка <a href="https://t.me/RobloxBank_PA" style="color:#7c5cff">@RobloxBank_PA</a></p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

/**
 * Письмо-открытка получателю. Код в письме НЕ виден — только кнопка на
 * `/gift/<токен>`. Отложенный подарок до `giftSendAt` не уходит: его отправит
 * тик (`/api/internal/codes/tick`).
 */
export async function sendGiftEmail(orderId: string, reason: "issued" | "resend" | "scheduled"): Promise<CodeEmailResult> {
  const order = await prisma.codeOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true, publicId: true, denomination: true, status: true, deliveryMode: true, recipientEmail: true,
      emailAttempts: true, activationCodeId: true, giftTheme: true, giftTo: true, giftFrom: true, giftMessage: true, giftSendAt: true,
    },
  });
  if (!order || order.status !== "ISSUED" || !order.activationCodeId || order.deliveryMode !== "GIFT") return "not_issued";
  if (!order.recipientEmail) return "no_address";
  // До выбранного дня открытка не уходит ни при выдаче, ни по «отправить ещё раз».
  if (reason !== "scheduled" && order.giftSendAt && order.giftSendAt.getTime() > Date.now()) return "scheduled";
  if (order.emailAttempts >= MAX_EMAIL_ATTEMPTS) return "exhausted";
  const theme = isGiftTheme(order.giftTheme) ? order.giftTheme : "JUST";
  const mail = buildGiftEmail({
    denomination: order.denomination,
    theme,
    to: order.giftTo,
    from: order.giftFrom,
    message: order.giftMessage,
    openUrl: giftTokenUrl(order.id),
  });
  const result = await sendMail({ to: order.recipientEmail, ...mail });
  await prisma.codeOrder.update({
    where: { id: order.id },
    data: result.ok
      ? { emailSentAt: new Date(), giftSentAt: new Date(), emailLastError: null, emailAttempts: { increment: 1 } }
      : { emailLastError: result.reason, emailAttempts: { increment: 1 } },
  });
  await prisma.codeOrderEvent.create({
    data: {
      orderId: order.id,
      type: result.ok ? "GIFT_EMAIL_SENT" : "GIFT_EMAIL_FAILED",
      idempotencyKey: `code-gift-email:${order.id}:${order.emailAttempts + 1}`,
      payload: { reason, ...(result.ok ? {} : { error: result.reason }) },
    },
  }).catch(() => undefined);
  return result.ok ? "sent" : "failed";
}

// ─── Ручной режим: «оплата получена, готовим код» ────────────────────────────

/**
 * Письмо сразу после оплаты, когда код выдаётся вручную (`CODES_BACKORDER`).
 * Без него покупатель видит списание и тишину. Срока не называем.
 */
export async function sendPaidAwaitingEmail(orderId: string): Promise<CodeEmailResult> {
  const found = await prisma.codeOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true, publicId: true, denomination: true, status: true, deliveryMode: true, recipientEmail: true,
      creator: { select: { email: true, emailVerifiedAt: true } },
      payments: { where: { status: "CONFIRMED" }, select: { receiptEmail: true }, take: 1 },
    },
  });
  if (!found || found.status !== "PAID") return "not_issued";
  // Ждущий подарка не должен узнать о нём раньше времени — пишем плательщику.
  const to = found.deliveryMode === "EMAIL"
    ? found.recipientEmail
    : found.payments[0]?.receiptEmail ?? (found.creator?.emailVerifiedAt ? found.creator.email : null);
  if (!to) return "no_address";
  const amount = found.denomination.toLocaleString("ru-RU");
  const where = found.deliveryMode === "GIFT"
    ? "Подарок-открытку отправим получателю, как только код будет готов (или в выбранный день)."
    : found.deliveryMode === "ACCOUNT"
      ? "Код появится в личном кабинете и придёт письмом."
      : "Код придёт на эту почту отдельным письмом.";
  const subject = `Оплата получена — готовим код на ${amount} Robux · ${found.publicId}`;
  const text = [
    `Оплата заказа ${found.publicId} получена — спасибо!`,
    "",
    `Готовим код активации на ${amount} Robux. ${where}`,
    "Ничего делать не нужно. Если появятся вопросы — напишите в поддержку, номер заказа выше.",
    "",
    `Поддержка: https://t.me/RobloxBank_PA · ${APP_URL}`,
  ].join("\n");
  const html = `<!doctype html><html lang="ru"><body style="margin:0;background:#f4f5fb;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#151827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;padding:28px"><tr><td>
<p style="margin:0 0 6px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#1f7a5f;font-weight:800">Оплата получена · ${escapeHtml(found.publicId)}</p>
<h1 style="margin:0 0 14px;font-size:23px;line-height:1.25">Готовим код на ${amount} Robux</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.55">${escapeHtml(where)}</p>
<p style="margin:0;font-size:15px;line-height:1.55;color:#4b4f66">Ничего делать не нужно. Если появятся вопросы — напишите нам, номер заказа выше.</p>
<p style="margin:18px 0 0;font-size:13px;color:#6b6f86">Поддержка: <a href="https://t.me/RobloxBank_PA" style="color:#7c5cff">@RobloxBank_PA</a></p>
</td></tr></table></td></tr></table></body></html>`;
  const result = await sendMail({ to, subject, text, html });
  await prisma.codeOrderEvent.create({
    data: {
      orderId: found.id,
      type: result.ok ? "PAID_NOTICE_SENT" : "PAID_NOTICE_FAILED",
      idempotencyKey: `code-paid-notice:${found.id}`,
      payload: result.ok ? {} : { error: result.reason },
    },
  }).catch(() => undefined);
  return result.ok ? "sent" : "failed";
}

/**
 * Всё, что происходит после того, как код закреплён за заказом: письмо (или
 * открытка), сообщение в чат бота. Сбой любого канала не трогает ни деньги,
 * ни код.
 */
export async function deliverIssuedCode(orderId: string, reason: "issued" | "manual"): Promise<{ email: CodeEmailResult; chat: boolean | null }> {
  const email = await sendCodeEmail(orderId, "issued").catch(() => "failed" as const);
  const chat = await sendCodeToChat(orderId).catch(() => false);
  void reason;
  return { email, chat };
}

// ─── Напоминание о неоплаченном заказе (15.11.2026) ──────────────────────────

export function buildPayReminderEmail(input: { denomination: number; amountRub: string; payUrl: string; share: boolean }): { subject: string; text: string; html: string } {
  const amount = input.denomination.toLocaleString("ru-RU");
  const lead = input.share
    ? `Ссылка на оплату кода на ${amount} Robux ещё не оплачена. Если её оплачивает родитель — напомните ему, ссылка та же.`
    : `Заказ кода на ${amount} Robux ждёт оплаты — цена ${input.amountRub} сохранена.`;
  const subject = `Код на ${amount} Robux ждёт оплаты`;
  const text = [lead, "", `Оплатить: ${input.payUrl}`, "", "Ссылка действует сутки с момента заказа. Если передумали — просто не оплачивайте.", "", `Поддержка: https://t.me/RobloxBank_PA`].join("\n");
  const html = `<!doctype html><html lang="ru"><body style="margin:0;background:#f4f5fb;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#151827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:20px;padding:28px"><tr><td>
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25">${escapeHtml(subject)}</h1>
<p style="margin:0 0 18px;font-size:15px;line-height:1.55">${escapeHtml(lead)}</p>
<a href="${escapeHtml(input.payUrl)}" style="display:block;text-align:center;background:#7c5cff;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:15px 18px;border-radius:14px">Оплатить ${escapeHtml(input.amountRub)}</a>
<p style="margin:16px 0 0;font-size:13px;color:#6b6f86;line-height:1.5">Ссылка действует сутки с момента заказа. Если передумали — просто не оплачивайте, ничего не спишется.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
