/**
 * Roblox API helpers for bot processes.
 *
 * Mirrors the subset of src/lib/roblox.ts needed by bots — kept here because
 * the bots/ TypeScript project has its own rootDir and cannot import from src/.
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
 *    (network-level failures — DNS, TLS, connection refused, etc.)
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

    // Retry on 5xx (transient server-side failures)
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

export interface GamepassDetails {
  id:        string;
  name:      string;
  price:     number;
  creatorId: number;
  isActive:  boolean;
  /**
   * true when every Roblox endpoint threw a network error (no HTTP response
   * received at all). Price and isActive are unreliable — callers should skip
   * those checks and accept the order for manual admin review.
   */
  validationSkipped?: boolean;
}

/**
 * Fetches gamepass metadata from Roblox, trying 4 API endpoints in sequence.
 *
 * Returns:
 *  • GamepassDetails          — on success
 *  • { validationSkipped: true } — when the server cannot reach Roblox at all
 *  • null                     — when Roblox is reachable but the gamepass was
 *                               not found / is invalid
 */
export async function getGamepassDetails(
  gamepassId: string
): Promise<GamepassDetails | null> {
  // Counts how many endpoints returned an HTTP response (even 404/403).
  // If this stays 0 after all attempts, the server has no network path to Roblox.
  let httpResponses = 0;

  // ── Attempt 1: modern game-passes API ──────────────────────────────────────
  try {
    const res = await rFetch(
      `https://apis.roblox.com/game-passes/v1/game-passes/${gamepassId}`
    );
    httpResponses++;
    if (res.ok) {
      const d = await res.json();
      return {
        id:        String(d.id ?? gamepassId),
        name:      d.name ?? d.displayName ?? "Gamepass",
        price:     d.price ?? 0,
        creatorId: d.sellerId ?? d.creatorId ?? 0,
        isActive:  d.isForSale !== false,
      };
    }
    {
      const body = await res.text().catch(() => "");
      console.warn(
        `[Roblox/bots] endpoint 1 failed: HTTP ${res.status} for id=${gamepassId}` +
        (body ? ` — ${body.slice(0, 200)}` : "")
      );
    }
  } catch {
    // network error — httpResponses stays unchanged
  }

  // ── Attempt 2: economy game-passes API ────────────────────────────────────
  try {
    const res = await rFetch(
      `https://economy.roblox.com/v1/game-passes/${gamepassId}/details`
    );
    httpResponses++;
    if (res.ok) {
      const d = await res.json();
      return {
        id:        String(d.TargetId ?? gamepassId),
        name:      d.Name ?? "Gamepass",
        price:     d.PriceInRobux ?? 0,
        creatorId: d.Creator?.Id ?? 0,
        isActive:  d.IsForSale ?? false,
      };
    }
    {
      const body = await res.text().catch(() => "");
      console.warn(
        `[Roblox/bots] endpoint 2 failed: HTTP ${res.status} for id=${gamepassId}` +
        (body ? ` — ${body.slice(0, 200)}` : "")
      );
    }
  } catch {
    // network error
  }

  // ── Attempt 3: economy assets API (gamepasses are asset type 34) ───────────
  // Different path from game-passes endpoint — sometimes one works when the
  // other returns 404 for recently created or private passes.
  try {
    const res = await rFetch(
      `https://economy.roblox.com/v1/assets/${gamepassId}/details`
    );
    httpResponses++;
    if (res.ok) {
      const d = await res.json();
      if (d?.TargetId || d?.Name) {
        return {
          id:        String(d.TargetId ?? gamepassId),
          name:      d.Name ?? "Gamepass",
          price:     d.PriceInRobux ?? 0,
          creatorId: d.Creator?.Id ?? 0,
          isActive:  d.IsForSale ?? false,
        };
      }
    }
    {
      const body = await res.text().catch(() => "");
      console.warn(
        `[Roblox/bots] endpoint 3 failed: HTTP ${res.status} for id=${gamepassId}` +
        (body ? ` — ${body.slice(0, 200)}` : "")
      );
    }
  } catch {
    // network error
  }

  // ── Attempt 4: www.roblox.com productinfo ─────────────────────────────────
  // Uses www.roblox.com (not api.roblox.com which is blocked on DC IPs).
  try {
    const res = await rFetch(
      `https://www.roblox.com/marketplace/productinfo?assetId=${gamepassId}`
    );
    httpResponses++;
    if (res.ok) {
      const d = await res.json();
      if (d?.AssetId) {
        return {
          id:        String(gamepassId),
          name:      d.Name ?? "Gamepass",
          price:     d.PriceInRobux ?? 0,
          creatorId: d.Creator?.Id ?? 0,
          isActive:  d.IsForSale ?? false,
        };
      }
    }
    {
      const body = await res.text().catch(() => "");
      console.warn(
        `[Roblox/bots] endpoint 4 failed: HTTP ${res.status} for id=${gamepassId}` +
        (body ? ` — ${body.slice(0, 200)}` : "")
      );
    }
  } catch {
    // network error
  }

  // ── All endpoints exhausted ────────────────────────────────────────────────
  if (httpResponses === 0) {
    // Server received zero HTTP responses — no network path to Roblox at all.
    // Return a "skipped" sentinel so callers can accept the order for manual
    // admin review rather than silently blocking every user.
    console.warn(
      `[Roblox/bots] All endpoints unreachable (network down) for id=${gamepassId}. ` +
      `Returning validationSkipped=true — admin must verify manually.`
    );
    return {
      id:               gamepassId,
      name:             "Неизвестно (Roblox недоступен)",
      price:            0,
      creatorId:        0,
      isActive:         true,
      validationSkipped: true,
    };
  }

  // At least one HTTP response was received → Roblox is reachable, gamepass not found.
  console.error(
    `[Roblox/bots] All 4 endpoints failed for id=${gamepassId} ` +
    `(${httpResponses} HTTP response(s) received, none successful)`
  );
  return null;
}
