/**
 * Roblox API helpers for bot processes.
 *
 * Mirrors the subset of src/lib/roblox.ts needed by bots — kept here because
 * the bots/ TypeScript project has its own rootDir and cannot import from src/.
 */

const UA = "Mozilla/5.0 (compatible; RobloxBank/1.0; +https://robloxbank.ru)";
const TIMEOUT_MS = 8_000;

function rFetch(url: string, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
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

    console.warn(
      `[Roblox/bots] getGamepassDetails: all 4 APIs failed for id=${gamepassId}`
    );
    return null;
  } catch (error) {
    console.error("[Roblox/bots] getGamepassDetails:", error);
    return null;
  }
}
