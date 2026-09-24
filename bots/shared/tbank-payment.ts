import crypto from "crypto";
import { PaymentAttemptStatus } from "@prisma/client";

const TBANK_API_BASE = "https://securepay.tinkoff.ru/v2";

function requiredEnv(name: "TINKOFF_TERMINAL_KEY" | "TINKOFF_SECRET_KEY") {
  const value = process.env[name];
  if (!value) throw new Error(`[TBank reconciliation] Missing ${name}`);
  return value;
}

function buildToken(params: Record<string, unknown>, password: string) {
  const pairs = Object.entries(params)
    .filter(([key, value]) => key !== "Token" && value !== null && value !== undefined)
    .map(([key, value]) => [key, String(value)] as const);
  pairs.push(["Password", password]);
  pairs.sort(([left], [right]) => left.localeCompare(right));
  return crypto.createHash("sha256").update(pairs.map(([, value]) => value).join(""), "utf8").digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function callTbank(method: "GetState" | "Cancel", paymentId: string) {
  const terminalKey = requiredEnv("TINKOFF_TERMINAL_KEY");
  const password = requiredEnv("TINKOFF_SECRET_KEY");
  const params: Record<string, unknown> = { TerminalKey: terminalKey, PaymentId: paymentId };
  const response = await fetch(`${TBANK_API_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, Token: buildToken(params, password) }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = record(await response.json().catch(() => null));
  if (!response.ok) throw new Error(`[TBank reconciliation] ${method} HTTP ${response.status}`);
  if (body.Success !== true) {
    throw new Error(`[TBank reconciliation] ${method}: ${String(body.Message ?? body.ErrorCode ?? "unknown error")}`);
  }
  if (String(body.PaymentId ?? "") !== paymentId) {
    throw new Error(`[TBank reconciliation] ${method}: PaymentId mismatch`);
  }
  return body;
}

export type TbankPaymentState = {
  paymentId: string;
  orderId: string | null;
  amountKopecks: number | null;
  status: string;
};

function parseState(body: Record<string, unknown>): TbankPaymentState {
  const amount = Number(body.Amount);
  return {
    paymentId: String(body.PaymentId),
    orderId: body.OrderId === null || body.OrderId === undefined ? null : String(body.OrderId),
    amountKopecks: Number.isSafeInteger(amount) ? amount : null,
    status: String(body.Status ?? "").toUpperCase(),
  };
}

export async function getTbankPaymentState(input: {
  paymentId: string;
  providerOrderId: string;
  amountKopecks: number;
}): Promise<TbankPaymentState> {
  const state = parseState(await callTbank("GetState", input.paymentId));
  if (!state.status) throw new Error("[TBank reconciliation] GetState returned no status");
  if (state.orderId !== null && state.orderId !== input.providerOrderId) {
    throw new Error("[TBank reconciliation] GetState OrderId mismatch");
  }
  if (state.amountKopecks !== null && state.amountKopecks !== input.amountKopecks) {
    throw new Error("[TBank reconciliation] GetState amount mismatch");
  }
  return state;
}

export async function cancelTbankPaymentSession(paymentId: string): Promise<TbankPaymentState> {
  return parseState(await callTbank("Cancel", paymentId));
}

const CANCELABLE_STALE_STATUSES = new Set([
  "NEW",
  "FORM_SHOWED",
  "AUTHORIZING",
  "3DS_CHECKING",
  "3DS_CHECKED",
  "AUTHORIZED",
]);

export function staleProviderPaymentNeedsCancel(status: string) {
  return CANCELABLE_STALE_STATUSES.has(status.toUpperCase());
}

export function internalPaymentStatus(status: string): PaymentAttemptStatus | null {
  switch (status.toUpperCase()) {
    case "CONFIRMED": return PaymentAttemptStatus.CONFIRMED;
    case "PARTIAL_REFUNDED": return PaymentAttemptStatus.PARTIALLY_REFUNDED;
    case "REFUNDED": return PaymentAttemptStatus.REFUNDED;
    case "CANCELED":
    case "REVERSED": return PaymentAttemptStatus.CANCELED;
    case "AUTH_FAIL":
    case "REJECTED":
    case "DEADLINE_EXPIRED":
    case "ATTEMPTS_EXPIRED": return PaymentAttemptStatus.REJECTED;
    default: return null;
  }
}
