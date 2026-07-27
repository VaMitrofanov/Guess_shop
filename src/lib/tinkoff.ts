/**
 * Tinkoff Merchant API Integration.
 * Docs: https://www.tinkoff.ru/kassa/develop/api/payments/
 */
import crypto from "crypto";

const TINKOFF_INIT_ENDPOINT = "https://securepay.tinkoff.ru/v2/Init";

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
export function buildTinkoffToken(params: Record<string, unknown>, secretKey: string): string {
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
  const token = buildTinkoffToken(params, secretKey);
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

export type CanonicalPaymentInit = {
  publicOrderId: string;
  amountKopecks: number;
  receiptEmail: string;
  description: string;
  statusToken: string;
};

type TinkoffInitDiagnosticResponse = {
  httpStatus?: number;
  contentType?: string | null;
  body?: unknown;
  networkError?: { name: string; message: string };
};

function diagnosticJsonLogsEnabled() {
  return process.env.TBANK_DIAGNOSTIC_JSON_LOGS === "true";
}

/**
 * Temporary support diagnostic. The exact Init body is intentionally logged,
 * including its one-request Token and callback URLs, so T-Bank can reproduce
 * signature validation. Password/SecretKey never enter the record.
 *
 * Keep TBANK_DIAGNOSTIC_JSON_LOGS disabled outside a controlled E2E: the body
 * contains the receipt email and an order-status bearer token in callback URLs.
 */
function logTinkoffInitExchange(
  requestBody: Record<string, unknown>,
  response: TinkoffInitDiagnosticResponse,
) {
  if (!diagnosticJsonLogsEnabled()) return;
  console.error(JSON.stringify({
    event: "tbank.init.exchange",
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    request: {
      method: "POST",
      url: TINKOFF_INIT_ENDPOINT,
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    },
    response,
  }));
}

function parseTinkoffJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { rawText: text };
  }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function buildCanonicalReceipt(email: string, amountKopecks: number) {
  if (!Number.isSafeInteger(amountKopecks) || amountKopecks <= 0) {
    throw new Error("[Tinkoff] Receipt amount must be positive integer kopecks");
  }
  return {
    Email: email.trim().toLowerCase(),
    Taxation: getRequiredEnv("TINKOFF_TAXATION"),
    Items: [{
      Name: "Цифровая услуга по заказу",
      Price: amountKopecks,
      Quantity: 1,
      Amount: amountKopecks,
      Tax: getRequiredEnv("TINKOFF_ITEM_TAX"),
      PaymentMethod: getRequiredEnv("TINKOFF_PAYMENT_METHOD"),
      PaymentObject: getRequiredEnv("TINKOFF_PAYMENT_OBJECT"),
    }],
  };
}

/**
 * Fiscalized Init for the canonical SITE flow. Unlike the legacy adapter this
 * accepts integer kopecks, includes NotificationURL and fails closed unless
 * the merchant's accountant/KKT operator supplied every receipt classifier.
 */
export async function initCanonicalTinkoffPayment(input: CanonicalPaymentInit) {
  const terminalKey = getRequiredEnv("TINKOFF_TERMINAL_KEY");
  const secretKey = getRequiredEnv("TINKOFF_SECRET_KEY");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://robloxbank.ru";
  const statusQuery = `orderId=${encodeURIComponent(input.publicOrderId)}&token=${encodeURIComponent(input.statusToken)}`;

  const params: Record<string, unknown> = {
    TerminalKey: terminalKey,
    Amount: input.amountKopecks,
    OrderId: input.publicOrderId,
    Description: input.description.slice(0, 140),
    NotificationURL: `${appUrl}/api/webhooks/tinkoff`,
    SuccessURL: `${appUrl}/payment/status?${statusQuery}&result=success`,
    FailURL: `${appUrl}/payment/status?${statusQuery}&result=fail`,
    DATA: { Email: input.receiptEmail },
    Receipt: buildCanonicalReceipt(input.receiptEmail, input.amountKopecks),
  };

  const body = { ...params, Token: buildTinkoffToken(params, secretKey) };
  let res: Response;
  let responseBody: unknown;
  try {
    res = await fetch(TINKOFF_INIT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    responseBody = parseTinkoffJson(await res.text());
  } catch (error) {
    logTinkoffInitExchange(body, {
      networkError: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }

  logTinkoffInitExchange(body, {
    httpStatus: res.status,
    contentType: res.headers.get("content-type"),
    body: responseBody,
  });
  if (!res.ok) throw new Error(`[Tinkoff] Init failed with HTTP ${res.status}`);

  const data = jsonRecord(responseBody);
  if (!data.Success || !data.PaymentId || !data.PaymentURL) {
    throw new Error(`[Tinkoff] Init error: ${data.Message ?? data.ErrorCode ?? "Unknown"}`);
  }
  return {
    paymentId: String(data.PaymentId),
    paymentUrl: String(data.PaymentURL),
  };
}

/**
 * U7 (ultra-review): раньше сюда передавали **остаток** платежа, а признак
 * «полный возврат» считался как `amount < remaining`. Возврат остатка после
 * частичного давал `600 === 600` → `partial = false` → `Receipt` не
 * передавался, и банк формировал закрывающий чек на **всю** исходную сумму
 * (1000 ₽ при фактически возвращённых 600 ₽, итого фискально 1400 при
 * реальных 1000).
 *
 * Теперь передаётся полная сумма платежа и сумма уже возвращённого. «Без
 * чека» — только когда возврат первый и сразу полный: именно в этом случае
 * закрывающий чек корректно формирует банк.
 */
export function refundNeedsReceipt(input: {
  amountKopecks: number;
  totalAmountKopecks: number;
  alreadyRefundedKopecks: number;
}): boolean {
  const firstAndFull =
    input.alreadyRefundedKopecks === 0 && input.amountKopecks === input.totalAmountKopecks;
  return !firstAndFull;
}

export async function cancelCanonicalTinkoffPayment(input: {
  paymentId: string;
  amountKopecks: number;
  /** Полная сумма исходного платежа (НЕ остаток). */
  totalAmountKopecks: number;
  /** Сколько по этому платежу уже возвращено ранее. */
  alreadyRefundedKopecks: number;
  receiptEmail: string;
}) {
  const terminalKey = getRequiredEnv("TINKOFF_TERMINAL_KEY");
  const secretKey = getRequiredEnv("TINKOFF_SECRET_KEY");
  if (
    !Number.isSafeInteger(input.amountKopecks) ||
    input.amountKopecks <= 0 ||
    input.amountKopecks + input.alreadyRefundedKopecks > input.totalAmountKopecks
  ) {
    throw new Error("[Tinkoff] Invalid refund amount");
  }
  const needsReceipt = refundNeedsReceipt(input);
  const params: Record<string, unknown> = {
    TerminalKey: terminalKey,
    PaymentId: input.paymentId,
    Amount: input.amountKopecks,
    // T-Bank сам формирует закрывающий чек только для первого и сразу полного
    // возврата. Во всех остальных случаях чек нужен ровно на возвращаемую часть.
    ...(needsReceipt ? { Receipt: buildCanonicalReceipt(input.receiptEmail, input.amountKopecks) } : {}),
  };
  const response = await fetch("https://securepay.tinkoff.ru/v2/Cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, Token: buildTinkoffToken(params, secretKey) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`[Tinkoff] Cancel failed with HTTP ${response.status}`);
  const data = await response.json();
  if (!data.Success) throw new Error(`[Tinkoff] Cancel error: ${data.Message ?? data.ErrorCode ?? "Unknown"}`);
  return { status: String(data.Status ?? "UNKNOWN"), raw: data as Record<string, unknown> };
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

  const computedToken = buildTinkoffToken(data, secretKey);

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
