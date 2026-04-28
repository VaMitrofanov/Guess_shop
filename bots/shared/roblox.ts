/**
 * Roblox API helpers for bot processes.
 *
 * Mirrors the subset of src/lib/roblox.ts needed by bots — kept here because
 * the bots/ TypeScript project has its own rootDir and cannot import from src/.
 *
 * Export surface:
 *   getGamepassDetails()       — public API: uses bridge if VALIDATOR_SOURCE_URL
 *                                is set, falls back to direct Roblox calls
 *   getGamepassDetailsDirect() — always hits Roblox directly; used by the
 *                                bridge server itself to avoid recursion
 */

// Mobile UA + Roblox-origin headers — mirrors what the Roblox Android app sends.
// Origin/Referer trick the API into treating the request as same-site frontend.
const UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36";

const ROBLOX_HEADERS: Record<string, string> = {
  "User-Agent":      UA,
  "Accept":          "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin":          "https://www.roblox.com",
  "Referer":         "https://www.roblox.com/",
};

const TIMEOUT_MS  = 30_000; // 30 s — Roblox APIs can be slow from DC IPs
const MAX_RETRIES = 3;
const RETRY_DELAY = 1_000;  // 1 s between retry attempts

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * fetch wrapper with:
 *  • AbortController-based 30 s timeout
 *  • Chrome User-Agent + Accept headers
 *  • 3-attempt retry on: AbortError, TimeoutError, or TypeError "fetch failed"
 *  • Retry also on 5xx responses
 */
async function rFetch(
  url: string,
  init: RequestInit = {},
  attempt = 1
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...ROBLOX_HEADERS,
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });

    if (res.status >= 500 && attempt < MAX_RETRIES) {
      const body = await res.text().catch(() => "");
      console.warn(
        `[Roblox/bots] rFetch attempt ${attempt}/${MAX_RETRIES}: ` +
        `HTTP ${res.status} from ${url}` +
        (body ? ` — body: ${body.slice(0, 300)}` : "")
      );
      await sleep(RETRY_DELAY);
      return rFetch(url, init, attempt + 1);
    }

    return res;
  } catch (err: any) {
    const isRetryable =
      err?.name === "AbortError" ||
      err?.name === "TimeoutError" ||
      (err?.name === "TypeError" &&
        typeof err?.message === "string" &&
        err.message.toLowerCase().includes("fetch failed"));

    console.warn(
      `[Roblox/bots] rFetch attempt ${attempt}/${MAX_RETRIES}: ` +
      `${err?.name ?? "Error"} for ${url} — ${err?.message ?? String(err)}`
    );
    if (isRetryable && attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY);
      return rFetch(url, init, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export interface GamepassDetails {
  id:        string;
  name:      string;
  price:     number;
  creatorId: number;
  isActive:  boolean;
  /**
   * true when every Roblox endpoint threw a network error (no HTTP response).
   * Callers should skip price/isActive checks and accept the order for manual
   * admin review.
   */
  validationSkipped?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Direct Roblox calls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hits Roblox APIs directly — no bridge routing.
 * Exported so the bridge server can call this without recursion.
 */
export async function getGamepassDetailsDirect(
  gamepassId: string
): Promise<GamepassDetails | null> {
  let httpResponses = 0;
  const numId = parseInt(gamepassId, 10);

  // ── Shared parser: handles both POST response shapes ─────────────────────
  // Logs the full object when isForSale=true but price is missing — this
  // surfaces any unexpected field names from Roblox's API for debugging.
  const parseItem = (d: any, source: string): GamepassDetails | null => {
    if (!d || typeof d !== "object") return null;

    const price: number =
      d.price          ?? // marketplace-items shape
      d.priceInRobux   ?? // catalog shape (camelCase)
      d.PriceInRobux   ?? // economy shape (PascalCase)
      0;

    const isActive: boolean =
      d.isForSale      !== undefined ? !!d.isForSale      :
      d.IsForSale      !== undefined ? !!d.IsForSale      :
      d.isPurchasable  !== undefined ? !!d.isPurchasable  :
      false;

    if (isActive && price === 0) {
      console.warn(
        `[Roblox/bots] ${source}: isForSale=true but price=0 — full object: ` +
        JSON.stringify(d)
      );
    }

    return {
      id:        String(d.id ?? d.assetId ?? d.TargetId ?? gamepassId),
      name:      d.name ?? d.Name ?? d.displayName ?? "Gamepass",
      price,
      creatorId: d.creatorId ?? d.sellerId ?? d.Creator?.Id ?? 0,
      isActive,
    };
  };

  // ── Attempt 1 — marketplace-items (Roblox mobile app endpoint) ───────────
  try {
    const res = await rFetch(
      "https://apis.roblox.com/marketplace-items/v1/items/details",
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ itemIds: [String(numId)], itemType: "GamePass" }),
      }
    );
    httpResponses++;
    if (res.ok) {
      const json = await res.json();
      // Response is either an array or { data: [...] }
      const items: any[] = Array.isArray(json) ? json : (json?.data ?? []);
      const item = items.find((x: any) => String(x?.id) === gamepassId || String(x?.assetId) === gamepassId) ?? items[0];
      const parsed = parseItem(item, "marketplace-items");
      if (parsed) return parsed;
    } else {
      const body = await res.text().catch(() => "");
      console.warn(`[Roblox/bots] endpoint 1 (marketplace-items) failed: HTTP ${res.status} for id=${gamepassId} — ${body.slice(0, 300)}`);
    }
  } catch { /* network error — httpResponses unchanged */ }

  // ── Attempt 2 — catalog items/details (POST) ─────────────────────────────
  try {
    const res = await rFetch(
      "https://catalog.roblox.com/v1/catalog/items/details",
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ items: [{ itemType: "Asset", id: numId }] }),
      }
    );
    httpResponses++;
    if (res.ok) {
      const json = await res.json();
      const items: any[] = Array.isArray(json) ? json : (json?.data ?? []);
      const item = items[0];
      const parsed = parseItem(item, "catalog/items/details");
      if (parsed) return parsed;
    } else {
      const body = await res.text().catch(() => "");
      console.warn(`[Roblox/bots] endpoint 2 (catalog/items/details) failed: HTTP ${res.status} for id=${gamepassId} — ${body.slice(0, 300)}`);
    }
  } catch { /* network error */ }

  // ── Attempt 3 — economy game-passes details (GET, public) ────────────────
  try {
    const res = await rFetch(
      `https://economy.roblox.com/v1/game-passes/${gamepassId}/details`
    );
    httpResponses++;
    if (res.ok) {
      const d = await res.json();
      const parsed = parseItem(d, "economy/game-passes");
      if (parsed) return parsed;
    } else {
      const body = await res.text().catch(() => "");
      console.warn(`[Roblox/bots] endpoint 3 (economy/game-passes) failed: HTTP ${res.status} for id=${gamepassId} — ${body.slice(0, 300)}`);
    }
  } catch { /* network error */ }

  // ── Attempt 4 — roproxy product-info mirror ───────────────────────────────
  try {
    const res = await rFetch(
      `https://apis.roproxy.com/game-passes/v1/game-passes/${gamepassId}/product-info`
    );
    httpResponses++;
    if (res.ok) {
      const parsed = parseItem(await res.json(), "roproxy/product-info");
      if (parsed) return parsed;
    } else {
      const body = await res.text().catch(() => "");
      console.warn(`[Roblox/bots] endpoint 4 (roproxy/product-info) failed: HTTP ${res.status} for id=${gamepassId} — ${body.slice(0, 300)}`);
    }
  } catch { /* network error */ }

  // ── All exhausted ─────────────────────────────────────────────────────────
  if (httpResponses === 0) {
    console.warn(
      `[Roblox/bots] All endpoints unreachable for id=${gamepassId}. ` +
      `validationSkipped=true — admin must verify manually.`
    );
    return {
      id:                gamepassId,
      name:              "Неизвестно (Roblox недоступен)",
      price:             0,
      creatorId:         0,
      isActive:          true,
      validationSkipped: true,
    };
  }

  console.error(
    `[Roblox/bots] All 4 endpoints failed for id=${gamepassId} ` +
    `(${httpResponses} HTTP response(s), none successful)`
  );
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bridge consumer
// ─────────────────────────────────────────────────────────────────────────────

// Sentinel: bridge was unreachable (network error) → fall back to direct calls
const BRIDGE_UNAVAILABLE = Symbol("BRIDGE_UNAVAILABLE");

async function fetchViaBridge(
  gamepassId: string,
  bridgeUrl: string,
  bridgeKey: string | undefined
): Promise<GamepassDetails | null | typeof BRIDGE_UNAVAILABLE> {
  const url =
    `${bridgeUrl.replace(/\/+$/, "")}/check-pass?id=${encodeURIComponent(gamepassId)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000); // 15 s bridge timeout

  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        ...(bridgeKey ? { "x-validator-key": bridgeKey } : {}),
      },
      signal: controller.signal,
    });

    if (res.status === 401) {
      console.error("[Roblox/bots] Bridge returned 401 — check VALIDATOR_KEY on both sides");
      // Treat auth error as unavailable so we fall back rather than blocking forever
      return BRIDGE_UNAVAILABLE;
    }

    const body = await res.json().catch(() => null);
    if (!body?.ok) {
      console.warn(
        `[Roblox/bots] Bridge non-ok response for id=${gamepassId}: ` +
        `HTTP ${res.status} — ${body?.error ?? "unknown"}`
      );
      return null; // bridge responded but said not found / error
    }

    // body.data may be null (gamepass not found) or a GamepassDetails object
    return (body.data ?? null) as GamepassDetails | null;
  } catch (err: any) {
    console.warn(
      `[Roblox/bots] Bridge unreachable for id=${gamepassId}: ${err?.message ?? err}`
    );
    return BRIDGE_UNAVAILABLE; // network error → caller will fall back to direct
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches gamepass metadata.
 *
 * Routing priority:
 *   1. If VALIDATOR_SOURCE_URL is set → call Singapore validation bridge.
 *      If bridge responds → return its result (trusted, no further calls).
 *      If bridge is unreachable (network error) → fall through to step 2.
 *   2. Direct Roblox API calls with retry + graceful degradation.
 */
export async function getGamepassDetails(
  gamepassId: string
): Promise<GamepassDetails | null> {
  const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();

  if (bridgeUrl) {
    const result = await fetchViaBridge(
      gamepassId,
      bridgeUrl,
      process.env.VALIDATOR_KEY?.trim()
    );
    if (result !== BRIDGE_UNAVAILABLE) {
      // Bridge gave a definitive answer (found, not found, or error) — trust it
      return result;
    }
    // Bridge is down → fall through to direct calls as last resort
    console.warn(
      `[Roblox/bots] Bridge unavailable — falling back to direct Roblox calls for id=${gamepassId}`
    );
  }

  return getGamepassDetailsDirect(gamepassId);
}
