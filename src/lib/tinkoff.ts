/**
 * Tinkoff Merchant API Integration.
 * Docs: https://www.tinkoff.ru/kassa/develop/api/payments/
 */
import crypto from "crypto";

// ── Guard: fail fast if secrets are missing ──────────────────────────────────
function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`[Tinkoff] Missing required env variable: ${key}`);
  return value;
}

// ── Signature helpers ────────────────────────────────────────────────────────

/**
 * Tinkoff token generation:
 * 1. Flatten all request/response fields into key-value pairs (exclude Token, Receipt, DATA, RECEIPT)
 * 2. Add Password (SecretKey) as "Password"
 * 3. Sort by key name alphabetically
 * 4. Concatenate values
 * 5. SHA-256 hash of the concatenated string
 */
function buildToken(params: Record<string, unknown>, secretKey: string): string {
  const EXCLUDED_KEYS = new Set(["Token", "Receipt", "DATA", "Items", "Shops"]);

  const pairs: { key: string; value: string }[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (EXCLUDED_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    pairs.push({ key, value: String(value) });
  }

  // Inject Password (secret key) as a field
  pairs.push({ key: "Password", value: secretKey });

  // Sort alphabetically by key
  pairs.sort((a, b) => a.key.localeCompare(b.key));

  const concatenated = pairs.map((p) => p.value).join("");
  return crypto.createHash("sha256").update(concatenated, "utf8").digest("hex");
}

// ── Init payment ─────────────────────────────────────────────────────────────

export async function initTinkoffPayment(
  orderId: string,
  amount: number,
  customerEmail?: string
): Promise<{ Success: boolean; PaymentId: string; PaymentURL: string; Message: string }> {
  const terminalKey = getRequiredEnv("TINKOFF_TERMINAL_KEY");
  const secretKey   = getRequiredEnv("TINKOFF_SECRET_KEY");

  // Tinkoff uses kopecks (amount × 100)
  const tinkoffAmount = Math.round(amount * 100);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://robloxbank.ru";

  const params: Record<string, unknown> = {
    TerminalKey: terminalKey,
    Amount:      tinkoffAmount,
    OrderId:     orderId,
    Description: `Покупка Robux — заказ ${orderId}`,
    SuccessURL:  `${appUrl}/payment/status?orderId=${orderId}&result=success`,
    FailURL:     `${appUrl}/payment/status?orderId=${orderId}&result=fail`,
    ...(customerEmail ? { Email: customerEmail } : {}),
  };

  // Compute and attach token
  const token = buildToken(params, secretKey);
  const body  = { ...params, Token: token };

  const res = await fetch("https://securepay.tinkoff.ru/v2/Init", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`[Tinkoff] Init failed with HTTP ${res.status}`);
  }

  const data = await res.json();

  if (!data.Success) {
    throw new Error(`[Tinkoff] Init error: ${data.Message ?? "Unknown"}`);
  }

  return {
    Success:    true,
    PaymentId:  String(data.PaymentId),
    PaymentURL: data.PaymentURL,
    Message:    "OK",
  };
}

// ── Webhook signature verification ───────────────────────────────────────────

/**
 * Verifies the Token field in Tinkoff webhook payloads.
 * Returns true only if the computed SHA-256 token matches the received token.
 */
export function verifyTinkoffSignature(data: Record<string, unknown>): boolean {
  const secretKey = process.env.TINKOFF_SECRET_KEY;
  if (!secretKey) {
    console.error("[Tinkoff] TINKOFF_SECRET_KEY is not set — cannot verify webhook");
    return false;
  }

  const receivedToken = data.Token as string | undefined;
  if (!receivedToken) {
    console.warn("[Tinkoff] Webhook missing Token field");
    return false;
  }

  const computedToken = buildToken(data, secretKey);

  // Timing-safe comparison to prevent timing attacks
  try {
    const a = Buffer.from(computedToken,  "hex");
    const b = Buffer.from(receivedToken,  "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
