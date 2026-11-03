import crypto from "node:crypto";

export const BOT_PAYMENT_TIMESTAMP_HEADER = "x-bot-payment-timestamp";
export const BOT_PAYMENT_SIGNATURE_HEADER = "x-bot-payment-signature";
export const BOT_PAYMENT_MAX_CLOCK_SKEW_MS = 5 * 60_000;

function secret() {
  const value = process.env.BOT_PAYMENT_API_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("BOT_PAYMENT_API_SECRET must contain at least 32 characters");
  return value;
}

export function signBotPaymentBody(timestamp: string, body: string) {
  return crypto.createHmac("sha256", secret()).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export function verifyBotPaymentBody(input: {
  timestamp: string | null;
  signature: string | null;
  body: string;
  now?: number;
}) {
  if (!input.timestamp || !input.signature || !/^\d{13}$/.test(input.timestamp)) return false;
  const now = input.now ?? Date.now();
  if (Math.abs(now - Number(input.timestamp)) > BOT_PAYMENT_MAX_CLOCK_SKEW_MS) return false;
  const expected = Buffer.from(signBotPaymentBody(input.timestamp, input.body), "hex");
  const actual = Buffer.from(input.signature, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function deterministicBotStatusToken(intentId: string) {
  return crypto.createHmac("sha256", secret()).update(`status:${intentId}`, "utf8").digest("base64url");
}

export function deterministicBotPublicOrderId(intentId: string) {
  const suffix = crypto.createHmac("sha256", secret()).update(`order:${intentId}`, "utf8").digest("hex").slice(0, 20);
  return `BOT-${suffix.toUpperCase()}`;
}
