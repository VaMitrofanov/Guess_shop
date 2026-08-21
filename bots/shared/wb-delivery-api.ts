import { z } from "zod";
import {
  WbBulkMutationResponseSchema,
  WbChatEventsResponseSchema,
  WbChatsResponseSchema,
  WbDbsClientResponseSchema,
  WbDbsOrdersResponseSchema,
  WbDeliveryDatesResponseSchema,
  WbStatusesResponseSchema,
  type WbBulkMutationResponse,
} from "./wb-delivery-contract";

const MARKETPLACE_BASE = "https://marketplace-api.wildberries.ru";
const CHAT_BASE = "https://buyer-chat-api.wildberries.ru";

type WbScope = "marketplace" | "chat";

function cleanToken(value: string | undefined): string {
  return (value ?? "").trim().replace(/^['"`]|['"`]$/g, "").trim();
}

function tokenFor(scope: WbScope): string {
  const scoped = scope === "marketplace"
    ? process.env.WB_MARKETPLACE_TOKEN
    : process.env.WB_CHAT_TOKEN;
  const token = cleanToken(scoped) || cleanToken(process.env.WB_API_TOKEN);
  if (!token) throw new WbDeliveryApiError(scope, 503, "TOKEN_MISSING", false);
  return token;
}

function safeProviderCode(body: unknown): string {
  if (!body || typeof body !== "object") return "UNKNOWN";
  const value = (body as Record<string, unknown>).code ?? (body as Record<string, unknown>).message;
  return typeof value === "string" || typeof value === "number"
    ? String(value).replace(/[^a-z0-9_.-]/gi, "_").slice(0, 80)
    : "UNKNOWN";
}

export class WbDeliveryApiError extends Error {
  constructor(
    readonly scope: WbScope,
    readonly status: number,
    readonly providerCode: string,
    readonly outcomeUnknown: boolean,
  ) {
    super(`WB_${scope.toUpperCase()}_${status}_${providerCode}`);
  }
}

async function requestJson<T>(
  scope: WbScope,
  url: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      ...init,
      headers: {
        Authorization: tokenFor(scope),
        Accept: "application/json",
        ...init.headers,
      },
    });
  } catch {
    throw new WbDeliveryApiError(scope, 0, "NETWORK_OR_TIMEOUT", init.method !== undefined && init.method !== "GET");
  }
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new WbDeliveryApiError(scope, response.status, safeProviderCode(body), response.status >= 500);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new WbDeliveryApiError(scope, 502, "SCHEMA_MISMATCH", false);
  return parsed.data;
}

function jsonBody(body: unknown): Pick<RequestInit, "method" | "headers" | "body"> {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function wbDeliveryApiReadiness() {
  return {
    marketplace: Boolean(cleanToken(process.env.WB_MARKETPLACE_TOKEN) || cleanToken(process.env.WB_API_TOKEN)),
    chat: Boolean(cleanToken(process.env.WB_CHAT_TOKEN) || cleanToken(process.env.WB_API_TOKEN)),
    scopedMarketplace: Boolean(cleanToken(process.env.WB_MARKETPLACE_TOKEN)),
    scopedChat: Boolean(cleanToken(process.env.WB_CHAT_TOKEN)),
  };
}

export async function fetchNewDbsOrders() {
  return requestJson("marketplace", `${MARKETPLACE_BASE}/api/v3/dbs/orders/new`, WbDbsOrdersResponseSchema);
}

export async function fetchCompletedDbsOrders(input: { dateFrom: Date; dateTo: Date; next?: string }) {
  const params = new URLSearchParams({
    limit: "1000",
    next: input.next ?? "0",
    dateFrom: String(Math.floor(input.dateFrom.getTime() / 1000)),
    dateTo: String(Math.floor(input.dateTo.getTime() / 1000)),
  });
  return requestJson("marketplace", `${MARKETPLACE_BASE}/api/v3/dbs/orders?${params}`, WbDbsOrdersResponseSchema);
}

export async function fetchDbsDeliveryDates(orderIds: string[]) {
  if (orderIds.length === 0) return { orders: [] };
  return requestJson(
    "marketplace",
    `${MARKETPLACE_BASE}/api/v3/dbs/orders/delivery-date`,
    WbDeliveryDatesResponseSchema,
    jsonBody({ orders: orderIds.map(Number) }),
  );
}

/** Buyer identity for DBS orders. WB only serves this after `confirm`, and it
 * is best-effort by design: a missing name costs the operator a nicer label,
 * never the order. */
export async function fetchDbsClients(orderIds: string[]) {
  if (orderIds.length === 0) return { orders: [] };
  return requestJson(
    "marketplace",
    `${MARKETPLACE_BASE}/api/v3/dbs/orders/client`,
    WbDbsClientResponseSchema,
    jsonBody({ orders: orderIds.map(Number) }),
  );
}

export async function fetchDbsStatuses(orderIds: string[]) {
  if (orderIds.length === 0) return { orders: [] };
  return requestJson(
    "marketplace",
    `${MARKETPLACE_BASE}/api/marketplace/v3/dbs/orders/status/info`,
    WbStatusesResponseSchema,
    jsonBody({ ordersIds: orderIds.map(Number) }),
  );
}

export async function fetchBuyerChats() {
  return requestJson("chat", `${CHAT_BASE}/api/v1/seller/chats`, WbChatsResponseSchema);
}

export async function fetchBuyerChatEvents(next?: string | null) {
  const suffix = next ? `?next=${encodeURIComponent(next)}` : "";
  return requestJson("chat", `${CHAT_BASE}/api/v1/seller/events${suffix}`, WbChatEventsResponseSchema);
}

export async function sendBuyerChatMessage(replySign: string, message: string): Promise<void> {
  const form = new FormData();
  form.set("replySign", replySign);
  form.set("message", message);
  await requestJson("chat", `${CHAT_BASE}/api/v1/seller/message`, z.unknown(), { method: "POST", body: form });
}

async function bulkStatusAction(action: "confirm" | "deliver", orderId: string): Promise<WbBulkMutationResponse> {
  return requestJson(
    "marketplace",
    `${MARKETPLACE_BASE}/api/marketplace/v3/dbs/orders/status/${action}`,
    WbBulkMutationResponseSchema,
    jsonBody({ ordersIds: [Number(orderId)] }),
  );
}

export function confirmDbsOrder(orderId: string) {
  return bulkStatusAction("confirm", orderId);
}

export function deliverDbsOrder(orderId: string) {
  return bulkStatusAction("deliver", orderId);
}

export async function receiveDbsOrder(orderId: string, code: string): Promise<WbBulkMutationResponse> {
  return requestJson(
    "marketplace",
    `${MARKETPLACE_BASE}/api/marketplace/v3/dbs/orders/status/receive`,
    WbBulkMutationResponseSchema,
    jsonBody({ orders: [{ orderId: Number(orderId), code }] }),
  );
}

export function assertBulkOrderSucceeded(response: WbBulkMutationResponse, orderId: string): void {
  const result = response.results.find((row) => row.orderId === orderId);
  if (!result || result.isError) {
    const providerCode = result?.errors[0]?.code ?? result?.errors[0]?.detail ?? "RESULT_MISSING";
    throw new WbDeliveryApiError("marketplace", 409, String(providerCode), false);
  }
}
