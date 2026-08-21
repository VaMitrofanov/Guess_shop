import crypto from "node:crypto";

export type BotPaymentMethod = "SITE" | "BOT_ACQUIRING" | "MANUAL_TRANSFER";
export type BotPaymentPlatform = "TG" | "VK";

export type BotPaymentResult = {
  ok: true;
  orderId: string;
  publicOrderId: string;
  wbCode: string;
  amountRobux: number;
  amountKopecks: number;
  method: BotPaymentMethod;
  paymentUrl?: string;
  statusUrl: string;
  manual?: { bank: string; recipient: string; phone: string };
  alreadyExists: boolean;
};

function requiredSecret() {
  const value = process.env.BOT_PAYMENT_API_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("BOT_PAYMENT_API_SECRET is not configured");
  return value;
}

export function botPaymentSignature(timestamp: string, body: string) {
  return crypto.createHmac("sha256", requiredSecret()).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export async function createBotPayment(input: {
  intentId: string;
  platform: BotPaymentPlatform;
  subject: string;
  receiptEmail: string;
  method: BotPaymentMethod;
}) {
  const body = JSON.stringify(input);
  const timestamp = String(Date.now());
  const base = (process.env.WEB_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://robloxbank.ru").replace(/\/$/, "");
  const response = await fetch(`${base}/api/internal/bot-payments`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bot-payment-timestamp": timestamp,
      "x-bot-payment-signature": botPaymentSignature(timestamp, body),
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({})) as Partial<BotPaymentResult> & { error?: string };
  if (!response.ok || data.ok !== true) throw new Error(data.error ?? `Payment API HTTP ${response.status}`);
  return data as BotPaymentResult;
}
