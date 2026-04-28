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

// Realistic browser UA — plain bot strings are rate-limited by Roblox edge nodes
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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
        "User-Agent":      UA,
        "Accept":          "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
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
  // Counts endpoints that returned any HTTP response (even 404/403).
  // If this stays 0, the server has no network path to Roblox at all.
  let httpResponses = 0;

  // ── Helper: parse product-info shape (apis.roblox.com / roproxy) ──────────
  const parseProductInfo = (d: any): GamepassDetails => ({
    id:        String(d.id ?? gamepassId),
    name:      d.name ?? d.displayName ?? "Gamepass",
    price:     d.price ?? 0,
    creatorId: d.sellerId ?? d.creatorId ?? 0,
    isActive:  d.isForSale !== false,
  });

  // ── Helper: parse economy shape ────────────────────────────────────────────
  const parseEconomy = (d: any): GamepassDetails => ({
    id:        String(d.TargetId ?? gamepassId),
    name:      d.Name ?? "Gamepass",
    price:     d.PriceInRobux ?? 0,
    creatorId: d.Creator?.Id ?? 0,
    isActive:  d.IsForSale ?? false,
  });

  // Attempt 1 — apis.roblox.com /product-info (correct endpoint)
  try {
    const res = await rFetch(
      `https://apis.roblox.com/game-passes/v1/game-passes/${gamepassId}/product-info`
    );
    httpResponses++;
    if (res.ok) return parseProductInfo(await res.json());
    const body = await res.text().catch(() => "");
    console.warn(`[Roblox/bots] endpoint 1 failed: HTTP ${res.status} for id=${gamepassId} — ${body.slice(0, 200)}`);
  } catch { /* network error — httpResponses unchanged */ }

  // Attempt 2 — roproxy mirror of the same endpoint (fallback if direct is blocked)
  try {
    const res = await rFetch(
      `https://apis.roproxy.com/game-passes/v1/game-passes/${gamepassId}/product-info`
    );
    httpResponses++;
    if (res.ok) return parseProductInfo(await res.json());
    const body = await res.text().catch(() => "");
    console.warn(`[Roblox/bots] endpoint 2 failed: HTTP ${res.status} for id=${gamepassId} — ${body.slice(0, 200)}`);
  } catch { /* network error */ }

  // Attempt 3 — economy game-passes API
  try {
    const res = await rFetch(
      `https://economy.roblox.com/v1/game-passes/${gamepassId}/details`
    );
    httpResponses++;
    if (res.ok) return parseEconomy(await res.json());
    const body = await res.text().catch(() => "");
    console.warn(`[Roblox/bots] endpoint 3 failed: HTTP ${res.status} for id=${gamepassId} — ${body.slice(0, 200)}`);
  } catch { /* network error */ }

  // All endpoints exhausted
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
    `[Roblox/bots] All 3 endpoints failed for id=${gamepassId} ` +
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
