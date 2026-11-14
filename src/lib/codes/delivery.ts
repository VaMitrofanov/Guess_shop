import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";
import { decryptActivationCode } from "@/lib/codes/secrets";

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
  const to = order.deliveryMode === "EMAIL"
    ? order.recipientEmail
    : order.creator?.emailVerifiedAt ? order.creator.email : null;
  return { order, to };
}

export type CodeEmailResult = "sent" | "no_address" | "not_issued" | "failed" | "exhausted";

/**
 * Отправить (или переотправить) письмо с уже выданным кодом. Новой оплаты и
 * новой выдачи не бывает: код берётся из заказа.
 */
export async function sendCodeEmail(orderId: string, reason: "issued" | "resend"): Promise<CodeEmailResult> {
  const found = await deliveryAddress(orderId);
  if (!found) return "not_issued";
  const { order, to } = found;
  if (order.status !== "ISSUED" || !order.activationCode) return "not_issued";
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
