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
  /** 🎁 Подарочная скидка, если именно она дала `discountPercent` (19.11.2026). */
  giftPercent?: number;
  invitedCount: number;
  referralCode: string;
  siteLink: string;
  subscribed: boolean;
  channelUrl: string;
  /** Курс ₽/$ для цен кодов (20.11.2026). Старый Web его не шлёт — тогда опорный. */
  usdRub?: number;
};

export type BotCodeOrder = {
  ok: true;
  publicId: string;
  denomination: number;
  finalAmountKopecks: number;
  baseAmountKopecks: number;
  discountPercent: number;
  /** Цена дана подарочной скидкой — потратится при оплате. */
  giftApplied?: boolean;
  payUrl: string;
  instant: boolean;
};

type Fail = { ok: false; code?: string; error?: string };

export async function botCodesView(platform: "TG" | "VK", subject: string, recheck = false): Promise<BotCodesView | Fail> {
  const { data } = await signedPost<BotCodesView | Fail>("/api/internal/bot-codes", { action: "view", platform, subject, ...(recheck ? { recheck: true } : {}) });
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

export type CodeIssueStatus =
  | "issued" | "not_found" | "not_paid" | "already" | "refunded"
  | "duplicate_code" | "bad_code" | "denomination_mismatch" | "count_mismatch" | "bad_request" | "error";

/**
 * Ручная выдача кода из беседы админов (16.11.2026) — тот же
 * `/api/internal/codes/issue`, что у `scripts/codes-issue.mjs`. Код в ответе
 * не возвращается; письмо/кабинет/чат бота сайт доставляет сам.
 */
export async function issueCodeViaWeb(publicId: string, code: string): Promise<{ status: CodeIssueStatus; email?: string; chat?: boolean | null }> {
  try {
    const { data } = await signedPost<{ ok?: boolean; status?: CodeIssueStatus; email?: string; chat?: boolean | null }>(
      "/api/internal/codes/issue", { publicId, code, label: "tg-reply" }, 30_000);
    return { status: data.status ?? "error", email: data.email, chat: data.chat };
  } catch {
    return { status: "error" };
  }
}

export type CodesQueueItem = {
  publicId: string;
  denomination: number;
  finalAmountKopecks: number;
  paidAt: string | null;
  channel: string;
  deliveryMode: string;
  giftSendAt: string | null;
};

/** Оплаченные заказы без кода — для `/codes` в теме «Коды». Без адресов и кодов. */
export async function fetchCodesQueue(): Promise<CodesQueueItem[] | null> {
  try {
    const { status, data } = await signedPost<{ waiting?: CodesQueueItem[] }>("/api/internal/codes/queue", {});
    return status === 200 ? data.waiting ?? [] : null;
  } catch {
    return null;
  }
}

export type CodeRevealResult =
  | { ok: true; publicId: string; denomination: number; codes: string[] }
  | { ok: false; status: "not_found" | "refunded" | "not_issued" | "gifted" | "bad_request" | "error" };

/** «👁 Показать код» в чате (21.11.2026): код — только создателю заказа; первое открытие видят админы. */
export async function botRevealCode(platform: "TG" | "VK", subject: string, publicId: string): Promise<CodeRevealResult> {
  try {
    const { data } = await signedPost<CodeRevealResult>("/api/internal/codes/reveal", { platform, subject, publicId });
    return data && typeof data === "object" && "ok" in data ? data : { ok: false, status: "error" };
  } catch {
    return { ok: false, status: "error" };
  }
}

/** Что сказать покупателю, если код не открылся. */
export function revealFailText(status: string): string {
  switch (status) {
    case "not_found": return "Этот код открывается только в аккаунте, который его купил.";
    case "gifted": return "Код подарен — его откроет получатель по ссылке. Чтобы забрать, нажмите «Вернуть себе» в кабинете.";
    case "refunded": return "Заказ отменён, деньги вернулись на карту — код больше не действует.";
    case "not_issued": return "Код ещё готовится — пришлём его сюда, как только будет готов.";
    default: return "Не получилось открыть код — попробуйте через минуту. Он есть и в кабинете на сайте.";
  }
}
