import crypto from "node:crypto";

/**
 * Клиент merchant API RBXRUBY (https://rbxruby.io/docs, 28.11.2026).
 *
 * Площадка сама выкупает геймпасс покупателя у своих продавцов; мы платим
 * долларами с баланса мерчанта. Цена резервируется при создании заказа:
 * `(цена пасса / 1000) × макс. курс мерчанта`, итог — по курсу продавца,
 * остаток возвращается на баланс. Коридор курса задаётся ТОЛЬКО в кабинете.
 *
 * Ключ — env `RBXRUBY_API_KEY` (заголовок `api-key`). В репозиторий не пишется.
 */

const BASE = "https://rbxruby.io/api";

export type RbxrubyStatus = "Pending" | "Queued" | "Completed" | "Cancelled" | "Error";
export const RBXRUBY_OPEN: readonly RbxrubyStatus[] = ["Pending", "Queued"];

export type RbxrubyOrder = {
  type?: string;
  uuid: string;
  orderId: string;
  price?: number;
  rate?: number;
  vendorId?: string | null;
  robuxAmount: number;
  status: RbxrubyStatus;
  robloxUserId?: number;
  robloxUsername: string;
  placeId?: number;
  gamepassId?: number;
  buyerRobloxId?: number;
  buyerRobloxUsername?: string;
  error?: { reason?: string; message?: string } | null;
};

export class RbxrubyError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly body?: unknown) {
    super(message);
    this.name = "RbxrubyError";
  }
}

export function rbxrubyKey(): string | null {
  const key = process.env.RBXRUBY_API_KEY?.trim();
  return key ? key : null;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const key = rbxrubyKey();
  if (!key) throw new RbxrubyError("RBXRUBY_API_KEY не задан", 0);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "api-key": key, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const obj = (data && typeof data === "object" ? data : {}) as { message?: unknown; code?: unknown };
    const message = typeof obj.message === "string" ? obj.message : `HTTP ${res.status}`;
    throw new RbxrubyError(message, res.status, typeof obj.code === "string" ? obj.code : undefined, data);
  }
  return data as T;
}

/** Доступные доллары (резерв открытых заказов сюда не входит). */
export async function rbxrubyBalance(): Promise<number> {
  const r = await call<{ balance: number }>("GET", "/shared/balance");
  return Number(r.balance);
}

/** Робуксы у продавцов по курсу не выше нашего макс. курса. */
export async function rbxrubyStock(): Promise<{ robuxAvailable: number; maxRobuxAvailable: number }> {
  return call("GET", "/orders/stock");
}

export async function rbxrubyDetailedStock(): Promise<Array<{ rate: number; accountsCount: number; maxInstantOrder: number; totalRobuxAmount: number }>> {
  return call("GET", "/orders/detailed-stock");
}

/** Пассы владельца на плейсе — только чтение, ничего не резервирует. */
export async function rbxrubyListPasses(robloxUsername: string, placeId: number | string): Promise<{
  placeId: number;
  universeId: number;
  robloxUserId: number;
  robloxUsername: string;
  passes: Array<{ passId: number; name: string; passPrice: number; robux: number }>;
}> {
  return call("POST", "/orders/gamepass/passes", { robloxUsername, placeUrl: String(placeId) });
}

/** СПИСЫВАЕТ (резервирует) деньги. Вызывать только из воркера в режиме `on`. */
export async function rbxrubyCreateGamepassOrder(input: {
  orderId: string;
  robloxUsername: string;
  robuxAmount: number;
  placeId: number;
  gamepassId: number;
}): Promise<RbxrubyOrder> {
  const r = await call<{ success: boolean; data: RbxrubyOrder }>("POST", "/orders/gamepass", input);
  return r.data;
}

export async function rbxrubyOrderInfo(orderId: string): Promise<RbxrubyOrder> {
  return call("POST", "/orders/info", { orderId });
}

/** Только для Queued/Error (Pending — 422). Резерв возвращается на баланс. */
export async function rbxrubyCancel(orderId: string): Promise<RbxrubyOrder> {
  return call("POST", "/orders/cancel", { orderId });
}

/**
 * Подпись вебхука: md5 hex от `base64(JSON без sign, в порядке ключей) + apiKey`.
 * Порядок ключей сохраняем как пришёл — JSON.parse его не меняет.
 */
export function verifyRbxrubySign(body: Record<string, unknown>, key = rbxrubyKey()): boolean {
  if (!key || typeof body.sign !== "string") return false;
  const { sign, ...rest } = body;
  const payload = Buffer.from(JSON.stringify(rest), "utf8").toString("base64");
  const expected = crypto.createHash("md5").update(payload + key, "utf8").digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(String(sign).toLowerCase(), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Наш id заказа у площадки: код гейта + попытка (повтор после отмены — новый id). */
export function rbxrubyOrderId(wbCode: string, attempt: number): string {
  return attempt <= 1 ? `rb-${wbCode}` : `rb-${wbCode}-${attempt}`;
}

/** Сколько зарезервируют, $: цена пасса / 1000 × курс, 3 знака. */
export function rbxrubyReserveUsd(passPrice: number, maxRate: number): number {
  return Math.round((passPrice / 1000) * maxRate * 1000) / 1000;
}
