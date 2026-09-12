/**
 * bossrobux.com API client.
 *
 * Auth: Token header (not Bearer). Set BOSSROBUX_TOKEN in env.
 *
 * Endpoints:
 *   POST /api/get-rb      → current rate + LK balance
 *   POST /api/get-gamepass → search gamepasses by name
 *   POST /api/get-orders  → purchase a gamepass
 */

const BASE_URL = "https://bossrobux.com/api";

function token(): string {
  return process.env.BOSSROBUX_TOKEN ?? "";
}

async function apiCall(endpoint: string, body: object = {}): Promise<unknown> {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: {
      "Token": token(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BossrobuxRate {
  rate:        number; // price per 1 R$ in platform currency
  robux_total: number; // total R$ available in LK
  robux_max:   number; // max R$ per single transaction
}

export interface BossrobuxGamepass {
  placeId:    number;
  productId:  number;
  gamepassId: number;
  name:       string;
  robux:      number;
  sellerName: string;
  image:      string;
}

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * GET-RB: fetch current rate and LK balance.
 * Returns null on network error or missing token.
 */
export async function getRate(): Promise<BossrobuxRate | null> {
  if (!token()) return null;
  try {
    const data = await apiCall("get-rb") as Record<string, unknown>;
    if (data.robux_total === undefined) return null;
    return {
      rate:        Number(data.rate),
      robux_total: Number(data.robux_total),
      robux_max:   Number(data.robux_max),
    };
  } catch {
    return null;
  }
}

/**
 * GET-GAMEPASS: search gamepasses by Roblox username of the client.
 * Pass the client's exact Roblox username (case-insensitive on bossrobux side).
 * Returns array of matching gamepasses, or { error } on failure.
 *
 * Response shape from server: { status: "success", data: [...] }
 * or { status: "error", msg: "..." }
 */
export async function searchGamepass(
  robloxUsername: string
): Promise<BossrobuxGamepass[] | { error: string }> {
  if (!token()) return { error: "BOSSROBUX_TOKEN не задан" };
  try {
    const data = await apiCall("get-gamepass", { name: robloxUsername }) as Record<string, unknown>;
    if (data.status === "success") {
      const arr = data.data;
      return Array.isArray(arr) ? (arr as BossrobuxGamepass[]) : [];
    }
    // Also handle legacy bare-array response (per docs example)
    if (Array.isArray(data)) return data as unknown as BossrobuxGamepass[];
    return { error: String(data.msg ?? "Неизвестная ошибка") };
  } catch {
    return { error: "Сеть недоступна" };
  }
}

/**
 * GET-ORDERS: purchase a gamepass.
 * Returns { success, msg }.
 */
export async function purchaseGamepass(
  gp: BossrobuxGamepass
): Promise<{ success: boolean; msg: string }> {
  if (!token()) return { success: false, msg: "BOSSROBUX_TOKEN не задан" };
  try {
    const data = await apiCall("get-orders", {
      placeId:    gp.placeId,
      productId:  gp.productId,
      gamepassId: gp.gamepassId,
      robux:      gp.robux,
      sellerName: gp.sellerName,
    }) as Record<string, unknown>;

    if (data.status === "success") {
      return { success: true, msg: String(data.msg ?? "Успешно") };
    }
    return { success: false, msg: String(data.msg ?? "Ошибка выкупа") };
  } catch {
    return { success: false, msg: "Сеть недоступна" };
  }
}
