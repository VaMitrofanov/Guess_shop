import crypto from "node:crypto";

/**
 * Клиент `/api/internal/bot-codes` и `/api/internal/codes/tick` для ботов
 * (15.11.2026). Подпись — та же HMAC, что у оплаты прямых заказов
 * (`BOT_PAYMENT_API_SECRET`, одинаков на Web/TG/VK).
 */

function secret(): string {
  const value = process.env.BOT_PAYMENT_API_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("BOT_PAYMENT_API_SECRET is not configured");
  return value;
}

export function webBase(): string {
  return (process.env.WEB_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://robloxbank.ru").replace(/\/$/, "");
}

/** Публичный адрес сайта для ссылок покупателю (WEB_BASE_URL может быть внутренним). */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://robloxbank.ru").replace(/\/$/, "");
}

async function signedPost<T>(path: string, payload: unknown, timeoutMs = 15_000): Promise<{ status: number; data: T }> {
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = crypto.createHmac("sha256", secret()).update(`${timestamp}.${body}`, "utf8").digest("hex");
  const response = await fetch(`${webBase()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bot-payment-timestamp": timestamp, "x-bot-payment-signature": signature },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({})) as T;
  return { status: response.status, data };
}

export type BotCodesView = {
  ok: true;
  salesOpen: boolean;
  instant: boolean;
  discountPercent: number;
  invitedCount: number;
  referralCode: string;
  siteLink: string;
};

export type BotCodeOrder = {
  ok: true;
  publicId: string;
  denomination: number;
  finalAmountKopecks: number;
  baseAmountKopecks: number;
  discountPercent: number;
  payUrl: string;
  instant: boolean;
};

type Fail = { ok: false; code?: string; error?: string };

export async function botCodesView(platform: "TG" | "VK", subject: string): Promise<BotCodesView | Fail> {
  const { data } = await signedPost<BotCodesView | Fail>("/api/internal/bot-codes", { action: "view", platform, subject });
  return data;
}

export async function botCodeOrder(platform: "TG" | "VK", subject: string, denomination: number, idempotencyKey: string): Promise<BotCodeOrder | Fail> {
  const { data } = await signedPost<BotCodeOrder | Fail>("/api/internal/bot-codes", { action: "order", platform, subject, denomination, idempotencyKey });
  return data;
}

export async function botAttachReferral(platform: "TG" | "VK", subject: string, code: string): Promise<string | null> {
  const { data } = await signedPost<{ ok: boolean; result?: string }>("/api/internal/bot-codes", { action: "referral", platform, subject, code });
  return data.ok ? data.result ?? null : null;
}

export async function codesTick(): Promise<{ gifts: number; chats: number } | null> {
  const { status, data } = await signedPost<{ ok?: boolean; gifts: number; chats: number }>("/api/internal/codes/tick", {}, 60_000);
  return status === 200 && data.ok ? data : null;
}

/**
 * Ключ идемпотентности заказа из бота: одно нажатие «800 R$» в течение 3 минут
 * — один заказ (двойной тап и повтор после таймаута не плодят заказы).
 */
export function botOrderKey(platform: string, subject: string, denomination: number, now = Date.now()): string {
  const bucket = Math.floor(now / (3 * 60 * 1000));
  const hex = crypto.createHash("sha256").update(`bot-code:${platform}:${subject}:${denomination}:${bucket}`).digest("hex");
  // Форма UUID v4 (сервер проверяет z.uuid()).
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
