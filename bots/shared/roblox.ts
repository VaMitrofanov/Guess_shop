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
 *  • AbortController-based 30 s timeout (explicit, works on all Node 18+ builds)
 *  • Chrome User-Agent + Accept headers to bypass bot-detection
 *  • 3-attempt retry on AbortError/TimeoutError or 5xx response
 *  • Diagnostic logging of every non-2xx status and error body
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
    // AbortError = our timeout fired; TimeoutError = alternative name in some runtimes
    const isTimeout = err?.name === "AbortError" || err?.name === "TimeoutError";
    console.warn(
      `[Roblox/bots] rFetch attempt ${attempt}/${MAX_RETRIES}: ` +
      `${err?.name ?? "Error"} for ${url} — ${err?.message ?? String(err)}`
    );
    if (isTimeout && attempt < MAX_RETRIES) {
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
}

/**
 * Fetches gamepass metadata from Roblox, trying 4 API endpoints in sequence.
 * Returns null when all endpoints fail or the pass does not exist.
 */
export async function getGamepassDetails(
  gamepassId: string
): Promise<GamepassDetails | null> {
  try {
    // Attempt 1: modern game-passes API
    const res1 = await rFetch(
      `https://apis.roblox.com/game-passes/v1/game-passes/${gamepassId}`
    );
    if (res1.ok) {
      const d = await res1.json();
      return {
        id:        String(d.id ?? gamepassId),
        name:      d.name ?? d.displayName ?? "Gamepass",
        price:     d.price ?? 0,
        creatorId: d.sellerId ?? d.creatorId ?? 0,
        isActive:  d.isForSale !== false,
      };
    }
    {
      const body = await res1.text().catch(() => "");
      console.warn(
        `[Roblox/bots] endpoint 1 failed: HTTP ${res1.status} for id=${gamepassId}` +
        (body ? ` — ${body.slice(0, 200)}` : "")
      );
    }

    // Attempt 2: economy API
    const res2 = await rFetch(
      `https://economy.roblox.com/v1/game-passes/${gamepassId}/details`
    );
    if (res2.ok) {
      const d = await res2.json();
      return {
        id:        String(d.TargetId ?? gamepassId),
        name:      d.Name ?? "Gamepass",
        price:     d.PriceInRobux ?? 0,
        creatorId: d.Creator?.Id ?? 0,
        isActive:  d.IsForSale ?? false,
      };
    }
    {
      const body = await res2.text().catch(() => "");
      console.warn(
        `[Roblox/bots] endpoint 2 failed: HTTP ${res2.status} for id=${gamepassId}` +
        (body ? ` — ${body.slice(0, 200)}` : "")
      );
    }

    // Attempt 3: catalog details endpoint
    const res3 = await rFetch(
      "https://catalog.roblox.com/v1/catalog/items/details",
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          items: [{ itemType: "GamePass", id: Number(gamepassId) }],
        }),
      }
    );
    if (res3.ok) {
      const d = await res3.json();
      const item = d.data?.[0];
      if (item) {
        return {
          id:        String(gamepassId),
          name:      item.name ?? "Gamepass",
          price:     item.lowestPrice ?? item.price ?? 0,
          creatorId: item.creatorTargetId ?? 0,
          isActive:  item.itemStatus !== "Offsale",
        };
      }
    }
    {
      const body = await res3.text().catch(() => "");
      console.warn(
        `[Roblox/bots] endpoint 3 failed: HTTP ${res3.status} for id=${gamepassId}` +
        (body ? ` — ${body.slice(0, 200)}` : "")
      );
    }

    // Attempt 4: legacy marketplace productinfo
    const res4 = await rFetch(
      `https://api.roblox.com/marketplace/productinfo?assetId=${gamepassId}`
    );
    if (res4.ok) {
      const d = await res4.json();
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
      const body = await res4.text().catch(() => "");
      console.warn(
        `[Roblox/bots] endpoint 4 failed: HTTP ${res4.status} for id=${gamepassId}` +
        (body ? ` — ${body.slice(0, 200)}` : "")
      );
    }

    console.error(
      `[Roblox/bots] getGamepassDetails: all 4 endpoints exhausted for id=${gamepassId}`
    );
    return null;
  } catch (error: any) {
    console.error(
      `[Roblox/bots] getGamepassDetails: unhandled error for id=${gamepassId}:`,
      error?.message ?? error
    );
    return null;
  }
}
