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

import { getBrowserGamepassPreflight, getBrowserSession, purchaseGamepassInBrowser } from "./browser-purchase";

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

// Persisted across calls — updated whenever Roblox returns a fresh token on 403.
let lastCsrfToken: string | null = null;

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
  attempt = 1,
  _csrfRetried = false
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...ROBLOX_HEADERS,
        ...(lastCsrfToken ? { "x-csrf-token": lastCsrfToken } : {}),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });

    // CSRF bypass: Roblox sends the valid token back on a 403 — update + retry once.
    if (res.status === 403 && !_csrfRetried) {
      const csrfToken = res.headers.get("x-csrf-token");
      if (csrfToken) {
        lastCsrfToken = csrfToken;
        console.log(`[Roblox/bots] CSRF 403 — token updated, retrying: ${url}`);
        clearTimeout(timer);
        return rFetch(url, init, attempt, true);
      }
    }

    // Rate-limited — back off 2.5 s then retry
    if (res.status === 429 && attempt < MAX_RETRIES) {
      console.warn(
        `[Roblox/bots] rFetch attempt ${attempt}/${MAX_RETRIES}: ` +
        `HTTP 429 (rate limited) from ${url} — waiting 2500ms`
      );
      await sleep(2_500);
      return rFetch(url, init, attempt + 1, _csrfRetried);
    }

    if (res.status >= 500 && attempt < MAX_RETRIES) {
      const body = await res.text().catch(() => "");
      console.warn(
        `[Roblox/bots] rFetch attempt ${attempt}/${MAX_RETRIES}: ` +
        `HTTP ${res.status} from ${url}` +
        (body ? ` — body: ${body.slice(0, 300)}` : "")
      );
      await sleep(RETRY_DELAY);
      return rFetch(url, init, attempt + 1, _csrfRetried);
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
      return rFetch(url, init, attempt + 1, _csrfRetried);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export interface GamepassDetails {
  id:          string;
  name:        string;
  price:       number;
  creatorId:   number;
  creatorName?: string;
  isActive:    boolean;
  /**
   * true when every Roblox endpoint threw a network error (no HTTP response).
   * Callers should skip price/isActive checks and accept the order for manual
   * admin review.
   */
  validationSkipped?: boolean;
  /** true when the gamepass's parent game is private / not playable. */
  isGamePrivate?: boolean;
  /**
   * true when roproxy returned IsForSale=true but the catalog endpoint returned
   * HTTP 200 with an empty items array — meaning the gamepass is not in the Roblox
   * marketplace (likely deleted after creation). Only set for recently-created
   * gamepasses (≤30 days). Callers should reject with a "gamepass not found" message.
   */
  isNotInCatalog?: boolean;
  /**
   * true when the gamepass's parent game has an 18+ age restriction.
   * The games API returns empty data for restricted games from unauthenticated
   * servers. Callers should reject with a "create gamepass in a regular game" message.
   */
  isAgeRestricted?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Direct Roblox calls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the game hosting this gamepass is private / not playable.
 *
 * @param strictOnUnavailable - When true, a 404 from the universe endpoint
 *   is treated as "game is private" rather than "API unavailable". Use only
 *   when there is already strong evidence the game is inaccessible (e.g. all
 *   primary Roblox endpoints also failed to find the gamepass).
 */
async function checkGamePrivate(gamepassId: string, strictOnUnavailable = false): Promise<boolean> {
  try {
    const uRes = await rFetch(
      `https://apis.roblox.com/universes/v1/assets/${gamepassId}/universe`
    );
    if (!uRes.ok) return strictOnUnavailable;
    const uData: any = await uRes.json().catch(() => null);
    const universeId = uData?.universeId;
    if (!universeId) return strictOnUnavailable;

    const pRes = await rFetch(
      `https://games.roblox.com/v1/games/multiget-playability-status?universeIds=${universeId}`
    );
    if (!pRes.ok) return false;
    const pData: any = await pRes.json().catch(() => null);
    const status = (Array.isArray(pData) ? pData : [])[0];
    if (!status) return false;

    const ps = status.playabilityStatus as string | undefined;
    // ContextualPlayabilityUnrated games are purchasable (commit cf287cc) —
    // keep all three playability checkers in this file consistent.
    if (ps === "Playable" || ps === "GuestProhibited" || ps === "ContextualPlayabilityUnrated") return false;
    if (ps === "PrivateGame" || ps === "GameUnapproved") return true;
    return status.isPlayable === false;
  } catch {
    return false;
  }
}

type GameAccessResult = "ok" | "private" | "age_restricted";

/**
 * Playability check keyed by placeId (not gamepassId).
 *
 * `apis.roblox.com/universes/v1/assets/{gamepassId}/universe` currently 404s from
 * our server IP, which cripples checkGamePrivate/checkGameAccess. The places-based
 * endpoint `universes/v1/places/{placeId}/universe` resolves reliably, and
 * getUserGamepasses() already hands us the placeId — so we can run the real
 * playability check on the gamepass's actual game.
 *
 * Returns "private" for unrated / private / unapproved games (gamepass not buyable),
 * "ok" otherwise. Playable + GuestProhibited both count as OK.
 */
async function placeIsPlayable(placeId: number): Promise<GameAccessResult> {
  try {
    if (!placeId) return "ok";
    const uRes = await rFetch(
      `https://apis.roblox.com/universes/v1/places/${placeId}/universe`
    ).catch(() => null);
    if (!uRes?.ok) return "ok";
    const uData: any = await uRes.json().catch(() => null);
    const universeId = uData?.universeId;
    if (!universeId) return "ok";

    const pRes = await rFetch(
      `https://games.roblox.com/v1/games/multiget-playability-status?universeIds=${universeId}`
    ).catch(() => null);
    if (!pRes?.ok) return "ok";
    const status = (((await pRes.json().catch(() => null)) as any[]) ?? [])[0];
    const ps = status?.playabilityStatus as string | undefined;
    if (ps === "Playable" || ps === "GuestProhibited" || ps === "ContextualPlayabilityUnrated") return "ok";
    if (ps === "PrivateGame" || ps === "GameUnapproved") return "private";
    return status?.isPlayable === false ? "private" : "ok";
  } catch {
    return "ok";
  }
}

/**
 * Detailed game access check used in the roproxy fallback block where
 * the creator ID is known. Distinguishes private games from 18+ restricted
 * ones: the games API returns empty data[] for restricted games when called
 * from an unauthenticated server.
 *
 * Falls back to looking up the creator's games when the direct asset→universe
 * lookup fails (age-restricted games return an error on that endpoint).
 */
async function checkGameAccess(
  gamepassId: string,
  creatorId:  number,
  strict = false
): Promise<GameAccessResult> {
  try {
    // Try to resolve universe ID via gamepass asset
    let universeId: number | null = null;
    const uRes = await rFetch(
      `https://apis.roblox.com/universes/v1/assets/${gamepassId}/universe`
    ).catch(() => null);
    if (uRes?.ok) {
      const uData: any = await uRes.json().catch(() => null);
      universeId = uData?.universeId ?? null;
    }

    // Fallback: look up via creator's games (works for 18+ games where the
    // asset endpoint returns an error for unauthenticated callers)
    if (!universeId && creatorId) {
      const cRes = await rFetch(
        `https://games.roblox.com/v2/users/${creatorId}/games?accessFilter=Public&limit=10`
      ).catch(() => null);
      if (cRes?.ok) {
        const cData: any = await cRes.json().catch(() => null);
        universeId = cData?.data?.[0]?.id ?? null;
      }
    }

    if (!universeId) return strict ? "age_restricted" : "ok";

    // games/v1 omits isPlayable/playabilityStatus — use the dedicated status endpoint
    const pRes = await rFetch(
      `https://games.roblox.com/v1/games/multiget-playability-status?universeIds=${universeId}`
    ).catch(() => null);
    if (!pRes?.ok) return "ok";
    const pData: any = await pRes.json().catch(() => null);
    const status = (Array.isArray(pData) ? pData : [])[0];
    if (!status) return "age_restricted"; // no data → API hides 18+ or restricted games

    const ps = status.playabilityStatus as string | undefined;
    // GuestProhibited = requires login but purchasable with authenticated account
    if (ps === "Playable" || ps === "GuestProhibited" || ps === "ContextualPlayabilityUnrated") return "ok";
    if (ps === "GameUnapproved") return "private";
    if (ps === "PrivateGame") return "private";
    // Unknown status — fall back to isPlayable flag
    if (status.isPlayable === false) return "private";
    return "ok";
  } catch {
    return "ok";
  }
}

/**
 * Hits Roblox APIs directly — no bridge routing.
 * Exported so the bridge server can call this without recursion.
 */
export async function getGamepassDetailsDirect(
  gamepassId: string
): Promise<GamepassDetails | null> {
  let httpResponses = 0;
  // True when at least one primary Roblox endpoint (1-3) returned the gamepass data.
  // Used to decide whether to apply strict private-game detection at the roproxy fallback.
  let foundInPrimary = false;
  // True when catalog returned HTTP 200 but an empty items array — the gamepass is not
  // in the Roblox marketplace. Used in the roproxy block to detect deleted gamepasses.
  let catalogReturned200Empty = false;
  const numId = parseInt(gamepassId, 10);

  // ── Shared parser: handles both POST response shapes ─────────────────────
  // Logs the full object when isForSale=true but price is missing — this
  // surfaces any unexpected field names from Roblox's API for debugging.
  const parseItem = (d: any, source: string): GamepassDetails | null => {
    if (!d || typeof d !== "object") return null; // caller already logged HTTP status

    // Reject catalog assets (clothing, accessories…) that share a numeric ID with a
    // gamepass. The catalog endpoint can return a non-gamepass item when itemType is
    // "Asset"; we guard here so all four attempts stay self-consistent.
    if (d.itemType && d.itemType !== "GamePass") {
      console.warn(`[Roblox/bots] ${source}: itemType=${d.itemType} for id=${gamepassId} — not a GamePass, skipping`);
      return null;
    }

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

    const creatorName: string | undefined =
      d.creatorName      ??
      d.sellerName       ??
      d.Creator?.Name    ??
      d.creatorTargetName ??
      undefined;

    if (isActive && price === 0) {
      console.warn(
        `[Roblox/bots] ${source}: isForSale=true but price=0 — full object: ` +
        JSON.stringify(d)
      );
    }

    if (!creatorName) {
      console.log(`[Roblox/Debug] ${source} — creatorName missing. Raw:`, JSON.stringify(d));
    }

    return {
      id:          String(d.id ?? d.assetId ?? d.TargetId ?? gamepassId),
      name:        d.name ?? d.Name ?? d.displayName ?? "Gamepass",
      price,
      creatorId:   d.creatorId ?? d.sellerId ?? d.Creator?.Id ?? 0,
      creatorName,
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
      const json: any = await res.json();
      // Response is either an array or { data: [...] }
      const items: any[] = Array.isArray(json) ? json : (json?.data ?? []);
      const item = items.find((x: any) => String(x?.id) === gamepassId || String(x?.assetId) === gamepassId) ?? items[0];
      const parsed = parseItem(item, "marketplace-items");
      if (parsed) {
        foundInPrimary = true;
        if (await checkGamePrivate(gamepassId)) parsed.isGamePrivate = true;
        return parsed;
      }
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
        body:    JSON.stringify({ items: [{ itemType: "GamePass", id: numId }] }),
      }
    );
    httpResponses++;
    if (res.ok) {
      const json: any = await res.json();
      const items: any[] = Array.isArray(json) ? json : (json?.data ?? []);
      if (items.length === 0) {
        catalogReturned200Empty = true;
        console.log(`[Roblox/bots] endpoint 2 (catalog/items/details): HTTP 200 empty for id=${gamepassId} — not in marketplace`);
      }
      const item = items[0];
      const parsed = parseItem(item, "catalog/items/details");
      if (parsed) {
        foundInPrimary = true;
        if (await checkGamePrivate(gamepassId)) parsed.isGamePrivate = true;
        return parsed;
      }
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
      if (parsed) {
        foundInPrimary = true;
        if (await checkGamePrivate(gamepassId)) parsed.isGamePrivate = true;
        return parsed;
      }
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
      const d: any = await res.json();
      const parsed = parseItem(d, "roproxy/product-info");
      if (parsed) {
        // Authoritative cross-check — reuses the dashboard search path.
        // The catalog / economy / universe-asset endpoints are unreliable from our IP
        // (they 404 or return HTTP 200 + empty array even for valid, for-sale passes),
        // which makes the heuristics below false-reject. getUserGamepasses() takes the
        // reliable route (user → public games → universes/{id}/game-passes listing) and
        // hands back the pass's placeId, so we can also run the real playability check
        // via places/{placeId}/universe (which resolves where the asset endpoint 404s).
        // Found + playable → trust it; found but unrated/private → block with the proper
        // message. A pass in a truly private game won't be listed at all (accessFilter=
        // Public) and falls through to the conservative heuristics below.
        if (parsed.isActive && !foundInPrimary && parsed.creatorName) {
          try {
            const listed = await getUserGamepasses(parsed.creatorName);
            const match  = listed.find((g) => String(g.gamepassId) === gamepassId);
            if (match) {
              if (match.robux > 0) parsed.price = match.robux;
              const access = await placeIsPlayable(match.placeId);
              if (access === "private") {
                console.warn(
                  `[Roblox/bots] roproxy: gamepass ${gamepassId} listed for sale but its game ` +
                  `(place ${match.placeId}) is unrated/private — isActive→false isGamePrivate→true`
                );
                parsed.isActive = false;
                parsed.isGamePrivate = true;
                return parsed;
              }
              console.log(
                `[Roblox/bots] roproxy: gamepass ${gamepassId} confirmed for-sale & playable via ` +
                `creator listing "${parsed.creatorName}" — accepting (primary endpoints degraded)`
              );
              return parsed; // isActive stays true — no heuristic downgrade
            }
          } catch { /* listing unavailable — fall through to conservative heuristics */ }
        }

        // If no primary endpoint found this gamepass (marketplace, economy all failed)
        // treat a universe 404 as "game is private" rather than "API temporarily down".
        // This catches the common case where the game was deleted or never made public.
        const strict = !foundInPrimary && httpResponses >= 2;
        const gameAccess = await checkGameAccess(gamepassId, parsed.creatorId, strict);
        if (gameAccess === "private")       parsed.isGamePrivate   = true;
        if (gameAccess === "age_restricted") parsed.isAgeRestricted = true;

        // Block gamepasses in PRIVATE games when no primary endpoint confirmed them.
        // Age-restricted (18+) games are allowed through — we can still purchase
        // those gamepasses with a verified account.
        if (parsed.isActive && parsed.isGamePrivate && !foundInPrimary) {
          console.warn(
            `[Roblox/bots] roproxy: gamepass ${gamepassId} is in a private game ` +
            `and no primary endpoint confirmed it — isActive→false`
          );
          parsed.isActive = false;
        }


        // Detect gamepasses deleted after creation:
        // roproxy can return stale cached data (IsForSale=true) for gamepasses that
        // no longer exist on roblox.com. If the catalog explicitly returned HTTP 200
        // with an empty array (not a rate-limit 429) AND no primary endpoint found it,
        // the gamepass is not in the marketplace → reject as non-existent.
        if (parsed.isActive && !foundInPrimary && catalogReturned200Empty) {
          const createdMs = d.Created ? new Date(d.Created).getTime() : NaN;
          const isRecent  = !isNaN(createdMs) && (Date.now() - createdMs) < 30 * 24 * 3_600_000;
          if (isRecent) {
            console.warn(
              `[Roblox/bots] roproxy: gamepass ${gamepassId} not found in catalog ` +
              `(catalog returned 200+empty, no primary endpoint confirmed) — isActive→false isNotInCatalog→true`
            );
            parsed.isActive = false;
            parsed.isNotInCatalog = true;
          }
        }

        return parsed;
      }
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
      creatorName:       undefined,
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

    const body = await (res.json().catch(() => null) as Promise<any>);
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

// ─────────────────────────────────────────────────────────────────────────────
// Gamepass search by Roblox username
// ─────────────────────────────────────────────────────────────────────────────

export interface GamepassSearchResult {
  gamepassId: number;
  productId:  number;
  placeId:    number;
  name:       string;
  robux:      number;
  sellerName: string;
  image:      string;
}

/**
 * Returns all for-sale gamepasses owned by a Roblox user.
 * Used by:
 *   • TG admin bot hub (direct call — already on SG)
 *   • Singapore bridge /search-gamepasses (called by TWA on RF)
 *
 * Filter: isForSale === true (strict — only explicitly for-sale passes).
 * Gamepasses without the isForSale field are excluded to prevent closed passes leaking through.
 */
/**
 * Returns purchase-ready data for a single gamepass by its ID.
 * Used when admin clicks "Выкупить через Boss Robux" on a specific order.
 */
export async function getGamepassForPurchase(gamepassId: string): Promise<GamepassSearchResult | null> {
  try {
    // Strategy 1: universe asset → game-passes list (pageSize=100, one cursor page)
    const uRes = await rFetch(`https://apis.roblox.com/universes/v1/assets/${gamepassId}/universe`).catch(() => null);
    if (uRes?.ok) {
      const uData: any = await uRes.json().catch(() => null);
      const universeId: number | undefined = uData?.universeId;
      if (universeId) {
        const [gRes, pRes] = await Promise.all([
          rFetch(`https://games.roblox.com/v1/games?universeIds=${universeId}`),
          rFetch(`https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes?passView=Full&pageSize=100`),
        ]);
        const gData: any  = gRes.ok  ? await gRes.json().catch(() => null)  : null;
        const pData: any  = pRes.ok  ? await pRes.json().catch(() => null)  : null;
        const placeId: number = gData?.data?.[0]?.rootPlaceId ?? 0;

        let gp = (pData?.gamePasses ?? []).find((p: any) => String(p.id) === String(gamepassId));

        // Try one more cursor page if not found in first 100
        if (!gp && pData?.nextPageCursor) {
          const p2Res = await rFetch(
            `https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes?passView=Full&pageSize=100&cursor=${encodeURIComponent(pData.nextPageCursor)}`
          ).catch(() => null);
          const p2Data: any = p2Res?.ok ? await p2Res.json().catch(() => null) : null;
          gp = (p2Data?.gamePasses ?? []).find((p: any) => String(p.id) === String(gamepassId));
        }

        if (gp) {
          const tRes = await rFetch(
            `https://thumbnails.roblox.com/v1/game-passes?gamePassIds=${gamepassId}&size=150x150&format=Png&isCircular=false`
          ).catch(() => null);
          const tData: any = tRes?.ok ? await tRes.json().catch(() => null) : null;
          const image = tData?.data?.[0]?.imageUrl
            ?? `https://www.roblox.com/asset-thumbnail/image?assetId=${gamepassId}&width=150&height=150&format=png`;

          console.log(`[Roblox/bots] getGamepassForPurchase: id=${gamepassId} → "${gp.name}" ${gp.price}R$ productId=${gp.productId}`);
          return {
            gamepassId: gp.id,
            productId:  gp.productId ?? 0,
            placeId,
            name:       gp.name ?? gp.displayName ?? "Gamepass",
            robux:      gp.price ?? 0,
            sellerName: gp.creator?.name ?? "Unknown",
            image,
          };
        }
        console.log(`[Roblox/bots] getGamepassForPurchase: id=${gamepassId} not in universe ${universeId} passes — trying fallback`);
      } else {
        console.log(`[Roblox/bots] getGamepassForPurchase: id=${gamepassId} → no universeId — trying fallback`);
      }
    } else {
      console.log(`[Roblox/bots] getGamepassForPurchase: id=${gamepassId} → universe endpoint failed — trying fallback`);
    }

    // Strategy 2: resolve creator via economy/roproxy → getUserGamepasses → find by ID
    let creatorName: string | null = null;

    const eRes = await rFetch(`https://economy.roblox.com/v1/game-passes/${gamepassId}/details`).catch(() => null);
    if (eRes?.ok) {
      const eData: any = await eRes.json().catch(() => null);
      creatorName = eData?.Creator?.Name ?? eData?.creatorName ?? null;
    }

    if (!creatorName) {
      const rRes = await rFetch(`https://apis.roproxy.com/game-passes/v1/game-passes/${gamepassId}/product-info`).catch(() => null);
      if (rRes?.ok) {
        const rData: any = await rRes.json().catch(() => null);
        creatorName = rData?.Creator?.Name ?? null;
      }
    }

    if (creatorName) {
      console.log(`[Roblox/bots] getGamepassForPurchase fallback: searching via creator "${creatorName}"`);
      const results = await getUserGamepasses(creatorName);
      const found = results.find(r => String(r.gamepassId) === String(gamepassId));
      if (found) {
        console.log(`[Roblox/bots] getGamepassForPurchase fallback success: id=${gamepassId} found via "${creatorName}"`);
        return found;
      }
      console.warn(`[Roblox/bots] getGamepassForPurchase fallback: id=${gamepassId} not in ${results.length} passes for "${creatorName}"`);
    } else {
      console.warn(`[Roblox/bots] getGamepassForPurchase: could not determine creator for id=${gamepassId}`);
    }

    return null;
  } catch (err: any) {
    console.error("[Roblox/bots] getGamepassForPurchase:", err?.message ?? err);
    return null;
  }
}

/**
 * Resolve a Roblox username to its numeric userId. Returns null when the user
 * doesn't exist (or has been banned, since we set excludeBannedUsers=true).
 *
 * Exported so callers that need to distinguish "user not found" from "user
 * exists but has no public/for-sale gamepasses" can branch on the result.
 * `getUserGamepasses` collapses both into [] for backward-compat with bridge
 * and TWA BossRobux callers; user-facing flows that need better diagnostics
 * use this primitive directly via `bots/shared/gamepass-search.ts`.
 */
export async function resolveRobloxUserId(username: string): Promise<number | null> {
  try {
    const uRes = await rFetch("https://users.roblox.com/v1/usernames/users", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
    });
    if (!uRes.ok) return null;
    const uData: any = await uRes.json().catch(() => null);
    const userId: number | undefined = uData?.data?.[0]?.id;
    return userId ?? null;
  } catch (err: any) {
    console.error("[Roblox/bots] resolveRobloxUserId:", err?.message ?? err);
    return null;
  }
}

export interface RobloxUserProfile {
  id:          string;
  name:        string;
  displayName: string;
  avatarUrl:   string | null;
  /** Только из `users/v1/users/<id>` — при резолве по нику Roblox их не отдаёт. */
  description?: string | null;
  created?:     string | null;
}

/**
 * Resolve a Roblox account to the card the site shows above the pass list:
 * id, canonical name, display name and headshot.
 *
 * Always hits Roblox directly — this is the primitive the bridge itself runs,
 * so it must never route back through `VALIDATOR_SOURCE_URL`.
 */
export async function getRobloxUserProfileDirect(
  ref: { username?: string; userId?: string | number },
): Promise<RobloxUserProfile | null> {
  try {
    let id = ref.userId != null ? String(ref.userId).trim() : "";
    let name = "";
    let displayName = "";
    let description: string | null = null;
    let created: string | null = null;

    if (!id) {
      const username = (ref.username ?? "").trim();
      if (!username) return null;
      const uRes = await rFetch("https://users.roblox.com/v1/usernames/users", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
      });
      if (!uRes.ok) return null;
      const uData: any = await uRes.json().catch(() => null);
      const hit = uData?.data?.[0];
      if (!hit?.id) return null;
      id          = String(hit.id);
      name        = String(hit.name ?? username);
      displayName = String(hit.displayName ?? name);
    } else {
      const dRes = await rFetch(`https://users.roblox.com/v1/users/${encodeURIComponent(id)}`);
      if (!dRes.ok) return null;
      const dData: any = await dRes.json().catch(() => null);
      if (!dData?.id) return null;
      name        = String(dData.name ?? "");
      displayName = String(dData.displayName ?? name);
      description = typeof dData.description === "string" ? dData.description : null;
      created     = typeof dData.created === "string" ? dData.created : null;
      if (!name) return null;
    }

    const tRes = await rFetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${id}&size=150x150&format=Png&isCircular=true`
    ).catch(() => null);
    const tData: any = tRes?.ok ? await tRes.json().catch(() => null) : null;

    return { id, name, displayName, description, created, avatarUrl: tData?.data?.[0]?.imageUrl ?? null };
  } catch (err: any) {
    console.error("[Roblox/bots] getRobloxUserProfileDirect:", err?.message ?? err);
    return null;
  }
}

export interface NickSearchPayload {
  /** null → Roblox says there is no such account (or it is banned). */
  account:    RobloxUserProfile | null;
  gamepasses: GamepassSearchResult[];
}

/**
 * One round trip behind the bridge's `/search-gamepasses`: resolve the account
 * and list its for-sale passes, keeping the two answers apart.
 *
 * The split matters — "no such nick" is the buyer's typo to fix, while "account
 * found, no passes" is the hidden-place case that the manual link entry exists
 * for. Collapsing both into an empty list is what sent buyers into a dead end.
 */
export async function searchGamepassesByNickDirect(username: string): Promise<NickSearchPayload> {
  const account = await getRobloxUserProfileDirect({ username });
  if (!account) return { account: null, gamepasses: [] };
  const gamepasses = await listForSaleGamepasses(Number(account.id), account.name);
  return { account, gamepasses };
}

/**
 * Fetch every for-sale gamepass across a userId's public games. Returns an
 * empty array when the user has no public games, or none of their games
 * carry a for-sale gamepass — the caller is responsible for diagnosing
 * which of these is the case (e.g. via the universes count if needed).
 *
 * `fallbackUsername` is used for the `sellerName` field if Roblox's creator
 * blob doesn't carry it back (rare, but happens for legacy gamepasses).
 */
export async function listForSaleGamepasses(
  userId: number,
  fallbackUsername: string,
): Promise<GamepassSearchResult[]> {
  // Fetch all public games with cursor-based pagination (up to 3 pages / 150 games)
  const universes: any[] = [];
  let gamesCursor: string | null = null;
  for (let page = 0; page < 3; page++) {
    const cursorParam = gamesCursor ? `&cursor=${encodeURIComponent(gamesCursor)}` : "";
    const gRes = await rFetch(
      `https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=50${cursorParam}`
    ).catch(() => null);
    if (!gRes?.ok) break;
    const gData: any = await gRes.json().catch(() => null);
    universes.push(...(gData?.data ?? []));
    gamesCursor = gData?.nextPageCursor ?? null;
    if (!gamesCursor) break;
  }

  if (universes.length === 0) {
    console.log(`[Roblox/bots] listForSaleGamepasses: no public games for userId=${userId}`);
    return [];
  }

  const passBatches = await Promise.all(universes.map(async (game: any) => {
    const placeId: number = game.rootPlaceId ?? game.rootPlace?.id ?? 0;
    const pRes = await rFetch(
      `https://apis.roblox.com/game-passes/v1/universes/${game.id}/game-passes?passView=Full&pageSize=100`
    ).catch(() => null);
    if (!pRes?.ok) return [];
    const pData: any = await pRes.json().catch(() => null);
    return (pData?.gamePasses ?? []).map((gp: any) => ({ ...gp, _placeId: placeId }));
  }));

  const all: any[] = passBatches.flat();
  if (all.length === 0) return [];

  const ids = all.map((gp: any) => gp.id).join(",");
  const tRes = await rFetch(
    `https://thumbnails.roblox.com/v1/game-passes?gamePassIds=${ids}&size=150x150&format=Png&isCircular=false`
  ).catch(() => null);
  const tData: any = tRes?.ok ? await tRes.json().catch(() => null) : null;
  const thumbMap: Record<number, string> = Object.fromEntries(
    (tData?.data ?? []).map((t: any) => [t.targetId, t.imageUrl])
  );

  // Relaxed filter: isForSale !== false (not strict === true) + price > 0.
  // The strict === true filter was silently dropping gamepasses where the API
  // omitted the isForSale field — the site never had this problem because
  // src/lib/roblox.ts returns all passes without filtering.
  const filtered = all
    .filter((gp: any) => gp.isForSale !== false && (gp.price ?? 0) > 0);

  if (all.length > 0 && filtered.length === 0) {
    console.warn(
      `[Roblox/bots] listForSaleGamepasses: ${all.length} passes found but ALL filtered out ` +
      `for userId=${userId}. Sample:`, JSON.stringify(all[0])
    );
  }

  return filtered
    .map((gp: any): GamepassSearchResult => ({
      gamepassId: gp.id,
      productId:  gp.productId ?? 0,
      placeId:    gp._placeId ?? 0,
      name:       gp.name ?? gp.displayName ?? "Gamepass",
      robux:      gp.price ?? 0,
      sellerName: gp.creator?.name ?? fallbackUsername,
      image:      thumbMap[gp.id]
        ?? `https://www.roblox.com/asset-thumbnail/image?assetId=${gp.id}&width=150&height=150&format=png`,
    }));
}

/**
 * Nickname search as the bots actually run it.
 *
 * Roblox's API hosts (`users`/`games`/`apis`/`thumbnails`.roblox.com) all live
 * on Roblox's own edge network, and TCP to it is blackholed from the Russian
 * host. Every direct attempt burns the full retry budget and then reports the
 * one thing that is certainly wrong — "no such nick" — while the buyer waits
 * a minute and a half for it. So when the bridge is configured we ask it first
 * and keep the direct path as the fallback for hosts that can reach Roblox.
 */
export async function searchGamepassesByNickRouted(username: string): Promise<NickSearchPayload> {
  const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();
  if (bridgeUrl) {
    const viaBridge = await searchViaBridge(username, bridgeUrl, process.env.VALIDATOR_KEY?.trim());
    if (viaBridge !== BRIDGE_UNAVAILABLE) return viaBridge;
    console.warn(`[Roblox/bots] Bridge unavailable for nick search "${username}" — falling back to direct`);
  }
  return searchGamepassesByNickDirect(username);
}

async function searchViaBridge(
  username: string,
  bridgeUrl: string,
  bridgeKey: string | undefined,
): Promise<NickSearchPayload | typeof BRIDGE_UNAVAILABLE> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${bridgeUrl.replace(/\/+$/, "")}/search-gamepasses`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept":       "application/json",
        ...(bridgeKey ? { "x-validator-key": bridgeKey } : {}),
      },
      body:   JSON.stringify({ username }),
      signal: controller.signal,
    });
    if (res.status === 401) {
      console.error("[Roblox/bots] Bridge returned 401 on search — check VALIDATOR_KEY on both sides");
      return BRIDGE_UNAVAILABLE;
    }
    const body: any = await res.json().catch(() => null);
    if (!body?.ok) {
      console.warn(`[Roblox/bots] Bridge non-ok search for "${username}": HTTP ${res.status} — ${body?.error ?? "unknown"}`);
      return BRIDGE_UNAVAILABLE;
    }
    const gamepasses: GamepassSearchResult[] = Array.isArray(body.gamepasses) ? body.gamepasses : [];
    // An older bridge answers without `account`/`userExists`. Passes on the wire
    // prove the account exists; nothing on the wire is genuinely ambiguous, and
    // reporting "account exists" there keeps the buyer pointed at the manual
    // link entry instead of at a nick that may be spelled perfectly well.
    const account = (body.account ?? null) as RobloxUserProfile | null;
    const userExists = typeof body.userExists === "boolean" ? body.userExists : true;
    if (!userExists) return { account: null, gamepasses: [] };
    return { account, gamepasses };
  } catch (err: any) {
    console.warn(`[Roblox/bots] Bridge unreachable for nick search "${username}": ${err?.message ?? err}`);
    return BRIDGE_UNAVAILABLE;
  } finally {
    clearTimeout(timer);
  }
}

export async function getUserGamepasses(username: string): Promise<GamepassSearchResult[]> {
  try {
    const userId = await resolveRobloxUserId(username);
    if (!userId) {
      console.log(`[Roblox/bots] getUserGamepasses: user "${username}" not found`);
      return [];
    }
    const results = await listForSaleGamepasses(userId, username);
    console.log(`[Roblox/bots] getUserGamepasses: "${username}" → ${results.length} for-sale pass(es)`);
    return results;
  } catch (err: any) {
    console.error("[Roblox/bots] getUserGamepasses:", err?.message ?? err);
    return [];
  }
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Purchase helpers (admin auto-buy)
// ─────────────────────────────────────────────────────────────────────────────

export interface GamepassProductInfo {
  productId:           number;
  priceInRobux:        number;
  userBasePriceInRobux: number;
  creatorId:           number;
  creatorName:         string;
  name:                string;
  isForSale:           boolean;
  isManagedPricing:    boolean;
  priceDiscountDetails: Array<{ Type?: string; AmountInRobux?: number; Percent?: number; EndTime?: string | null }>;
  robloxPlusDiscountPercent: number | null;
  hasUnsafeBuyerPrice: boolean;
  buyerUserId?: number;
  buyerName?: string;
  buyerBalance?: number;
}

/**
 * Fetches product-info for a gamepass — returns everything needed
 * for a purchase script and managed pricing detection.
 */
export async function getGamepassProductInfo(
  gamepassId: string,
  buyerCookie?: string,
): Promise<GamepassProductInfo | null> {
  try {
    if (buyerCookie) {
      const preflight = await getBrowserGamepassPreflight(buyerCookie, gamepassId);
      if (!preflight.ok || !preflight.gamepass) return null;
      const gp = preflight.gamepass;
      const parsed = parseProductInfo({
        ProductId: gp.productId,
        PriceInRobux: gp.price,
        UserBasePriceInRobux: gp.basePriceInRobux,
        PriceDiscountDetails: gp.priceDiscountDetails,
        Creator: { Id: gp.sellerId, Name: gp.sellerName },
        Name: gp.name,
        IsForSale: gp.isForSale,
      });
      return parsed ? {
        ...parsed,
        buyerUserId: preflight.session?.accountId,
        buyerName: preflight.session?.accountName,
        buyerBalance: preflight.session?.balance,
      } : null;
    }
    const res = await rFetch(
      `https://apis.roblox.com/game-passes/v1/game-passes/${gamepassId}/product-info`,
      {},
    );
    if (!res.ok) {
      // Fallback to roproxy
      const rr = await rFetch(
        `https://apis.roproxy.com/game-passes/v1/game-passes/${gamepassId}/product-info`,
      );
      if (!rr.ok) return null;
      const d: any = await rr.json();
      return parseProductInfo(d);
    }
    const d: any = await res.json();
    return parseProductInfo(d);
  } catch (err: any) {
    console.error("[Roblox/bots] getGamepassProductInfo:", err?.message ?? err);
    return null;
  }
}

function parseProductInfo(d: any): GamepassProductInfo | null {
  if (!d || !d.ProductId) return null;
  const price = d.PriceInRobux ?? 0;
  const base  = d.UserBasePriceInRobux ?? price;
  const details = Array.isArray(d.PriceDiscountDetails) ? d.PriceDiscountDetails : [];
  const plus = classifyRobloxPlusPrice(price, base, details);
  return {
    productId:            d.ProductId,
    priceInRobux:         price,
    userBasePriceInRobux: base,
    creatorId:            d.Creator?.Id ?? d.Creator?.CreatorTargetId ?? 0,
    creatorName:          d.Creator?.Name ?? "Unknown",
    name:                 d.Name ?? "Gamepass",
    isForSale:            d.IsForSale ?? false,
    isManagedPricing:     price !== base,
    priceDiscountDetails: details,
    robloxPlusDiscountPercent: plus.percent,
    hasUnsafeBuyerPrice: price !== base && !plus.valid,
  };
}

function classifyRobloxPlusPrice(
  price: number,
  base: number,
  details: Array<{ Type?: string; AmountInRobux?: number; Percent?: number }>,
): { valid: boolean; percent: number | null } {
  if (price === base) return { valid: false, percent: null };
  if (details.length !== 1) return { valid: false, percent: null };
  const d = details[0];
  const percent = Number(d.Percent);
  const amount = Number(d.AmountInRobux);
  const valid = d.Type === "RobloxPlusSubscription"
    && (percent === 10 || percent === 20)
    && Number.isInteger(amount)
    && amount > 0
    && amount === Math.floor(base * percent / 100)
    && price === base - amount;
  return { valid, percent: valid ? percent : null };
}

// Скрипт покупки собирается в roblox-purchase-script.ts: он общий для ручной консоли
// и будущего headless-транспорта, и зашивает цену по номиналу, а не live-цену.

// ── Purchase through the SG browser donor boundary ──────────────────────────

export function resetPurchaseCsrf(): void {
  // Browser service has no shared CSRF cache. Kept as a compatibility no-op
  // for existing /setcookie call sites.
}

export interface PurchaseResult {
  success: boolean;
  msg:     string;
  price?:  number;
  reason?: string;
  balance?: number | null;
}

/** Roblox removed the legacy cookie purchase endpoint on 2026-04-10. */
export function isLegacyPurchaseFlowFailure(reason: string | null | undefined): boolean {
  return /invalid.?arguments|invalid.?parameter/i.test(String(reason ?? ""));
}

export async function purchaseGamepassDirect(
  productId: number,
  expectedPrice: number,
  expectedSellerId: number,
  cookie: string,
  gamepassId?: string | number,
): Promise<PurchaseResult> {
  if (!gamepassId) {
    return {
      success: false,
      msg: "BrowserUnavailable: browser transport требует gamepassId",
      reason: "BrowserUnavailable",
    };
  }
  const browserSession = await getBrowserSession(cookie);
  const buyer = browserSession.session
    ? { id: browserSession.session.accountId, name: browserSession.session.accountName }
    : null;
  if (!browserSession.ok || !buyer) {
    const reason = `${browserSession.code}: ${browserSession.reason ?? "browser session недоступна"}`;
    return {
      success: false,
      msg: reason,
      reason,
    };
  }

  const result = await purchaseGamepassInBrowser({
    cookie,
    gamepassId,
    productId,
    expectedPrice,
    sellerId: expectedSellerId,
    buyerUserId: buyer.id,
  });
  if (result.purchased) {
    return {
      success: true,
      msg: `Куплено браузером за ${result.price ?? expectedPrice} R$`,
      price: result.price ?? expectedPrice,
      reason: result.reason,
      balance: result.balanceAfter ?? null,
    };
  }
  const failureReason = result.code ? `${result.code}: ${result.reason}` : result.reason;
  return {
    success: false,
    msg: failureReason || "Неизвестная ошибка browser transport",
    reason: failureReason,
    balance: result.balanceAfter ?? null,
  };
}

export async function getRobuxBalance(cookie: string): Promise<number | null> {
  const result = await getBrowserSession(cookie);
  return result.ok ? result.session?.balance ?? null : null;
}

export async function getAuthenticatedUser(
  cookie: string,
): Promise<{ id: number; name: string } | null> {
  const result = await getBrowserSession(cookie);
  return result.ok && result.session
    ? { id: result.session.accountId, name: result.session.accountName }
    : null;
}

// ── Контрольная проверка владения после ошибки выкупа (Ф1) ──────────────────
//
// Roblox при таймауте/5xx нередко всё же проводит транзакцию, а клиентский код
// видит провал. Любой провал, кроме «чистых отказов без списания», перепроверяем
// по inventory-API: владение = покупка на самом деле прошла (recovered-успех).
// Зеркало: src/lib/roblox-buyout.ts (bots/ и src/ не импортируют друг друга) —
// менять синхронно.

/** Отказы, при которых Roblox гарантированно НЕ провёл транзакцию. */
const CLEAN_REFUSAL_RE = /insufficient.?funds|not.?for.?sale|price.?changed|cookie|invalid.?arguments|invalid.?parameter|BrowserUnavailable|NotLoggedIn|WrongAccount|TwoStepRequired|CookieInjectionFailed|QueueFull|DriverError|BalanceMismatch|BalanceUnconfirmed|GuardStop|ScriptRefused|AlreadyOwned|NotConfirmed|BuyButtonMissing/i;

/**
 * Нужна ли контрольная проверка владения после провала покупки.
 * reason отсутствует у сетевых ошибок/таймаутов/нераспарсенных ответов —
 * там проверка нужна обязательно.
 */
export function needsOwnershipCheck(reason: string | null | undefined): boolean {
  return !(reason && CLEAN_REFUSAL_RE.test(reason));
}

/**
 * Владеет ли аккаунт cookie геймпассом. true/false — достоверный ответ,
 * null — проверка недоступна (сеть/авторизация), трактовать консервативно.
 */
export async function verifyGamepassOwnership(
  cookie: string,
  gamepassId: string | number,
): Promise<boolean | null> {
  const result = await getBrowserGamepassPreflight(cookie, gamepassId);
  return result.ok ? result.gamepass?.owned ?? null : null;
}

export interface VerifiedPurchaseResult extends PurchaseResult {
  /** Покупка провалилась по ответу Roblox, но владение подтвердилось проверкой. */
  recovered?: boolean;
}

/**
 * purchaseGamepassDirect + контрольная проверка владения при провале.
 * При таймауте/«нет ответа» (без каноничного reason) проверка повторяется
 * ещё раз — покупка могла провестись на стороне Roblox с задержкой.
 */
export async function purchaseGamepassVerified(
  productId: number,
  expectedPrice: number,
  expectedSellerId: number,
  cookie: string,
  gamepassId: string | number,
  delays: { firstMs?: number; retryMs?: number } = {},
): Promise<VerifiedPurchaseResult> {
  const result = await purchaseGamepassDirect(productId, expectedPrice, expectedSellerId, cookie, gamepassId);
  if (result.success || !needsOwnershipCheck(result.reason)) return result;

  await sleep(delays.firstMs ?? 2_500);
  let owned = await verifyGamepassOwnership(cookie, gamepassId);
  if (owned !== true && (owned === null || !result.reason)) {
    await sleep(delays.retryMs ?? 5_000);
    owned = await verifyGamepassOwnership(cookie, gamepassId);
  }
  if (owned === true) {
    console.warn(
      `[Roblox/purchase] recovered: продукт ${productId} — владение подтверждено после ошибки «${result.msg}»`,
    );
    return {
      success: true,
      recovered: true,
      msg: `Куплено (владение подтверждено проверкой после ошибки: ${result.msg})`,
      price: expectedPrice,
    };
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════════════
// Создание геймпасса через Open Cloud — движок автосоздания (Part 1, ДОРМАНТ)
//
// Проверено живьём 05.09.2026 (mono262910, universe 10302269431) и повторено
// 06.09.2026 на двух аккаунтах (KrytishVadim4ick 3870886947 → пасс 1963665231
// @100; mono262910 → пасс 1970321037 @228). Open Cloud создаёт ПОКУПАЕМЫЙ
// геймпасс нужного номинала ОДНИМ запросом. Факты (память
// project_roblox_opencloud_gamepass_api):
//   • POST https://apis.roblox.com/game-passes/v1/universes/{U}/game-passes
//   • Тело — multipart/form-data c ASP.NET model-binding: request.Name,
//     request.Price, request.IsForSale. JSON → 415. Иконка (request.Icon)
//     НЕобязательна. IsForSale=true проходит прямо при создании — отдельный
//     PATCH не нужен (оставлен подстраховкой).
//   • СКОУП КЛЮЧА (06.09): в Creator Hub нужен API System `game-passes` с
//     операциями `game-pass:read` + `game-pass:write`. Соседний `legacy-game-passes
//     → legacy-game-pass:manage` НЕ РАБОТАЕТ вовсе: 403 "Scope not authorized"
//     даже на чтение. Выбора experience у ключа нет — он покрывает ВСЕ опыты
//     своего владельца и только их.
//   • Два разных 403 (различаем, потому что лечатся по-разному):
//       "Scope not authorized"  → ключ сделан не на том API System (перебор
//                                 кандидатов бессмыслен, нужен новый ключ);
//       "UnauthorizedAccess … universe" → опыт чужой для этого ключа →
//                                 пробуем следующего кандидата.
//     Пасс в обоих случаях не создаётся — перебор безопасен.
//   • Иконка бизнесу не важна; важны ЦЕНА и факт «в продаже». Имя — наше, и
//     оно же реклама: брендовое «RobloxBank …» на чужом опыте (BRAND_GAMEPASS_NAMES).
//
// ДОРМАНТ: движок вызывают только мостовой роут POST /create-gamepass и
// ops-скрипт. В клиентский флоу НЕ подключён — ждёт инструкции V2 и прогона.
// Ключ клиента здесь только проходит транзитом; НИКОГДА не логировать его.
// ══════════════════════════════════════════════════════════════════════════

const OPEN_CLOUD_GAMEPASS_BASE = "https://apis.roblox.com/game-passes/v1/universes";

export interface CreateGamePassParams {
  /** Open Cloud API-ключ клиента (API System `game-passes`: read + write). */
  apiKey: string;
  /** Цена в робуксах — единственное, что реально важно бизнесу. */
  priceInRobux: number;
  /** Название пасса. Наше, не клиентское; по умолчанию нейтральное по номиналу. */
  name?: string;
  /** Явный universe, если известен. */
  universeId?: string | number;
  /** Явный placeId (резолвится в universe). */
  placeId?: string | number;
  /** Ник владельца — резолвится в его публичные experience'ы. */
  username?: string;
}

export interface CreateGamePassResult {
  ok: boolean;
  gamePassId?: number;
  universeId?: string;
  priceInRobux?: number;
  isForSale?: boolean;
  name?: string;
  /**
   * Машинный код: bad_key | bad_scope | bad_scope_write | not_authorized |
   * no_universe | bad_price | roblox_error | network.
   *
   * `bad_scope` — ключ не умеет ничего (выбран не тот API System);
   * `bad_scope_write` — читать умеет, создавать нет (отмечена одна операция).
   */
  error?: string;
  /** Человекочитаемая деталь для админа (без ключа!). */
  detail?: string;
}

/**
 * Брендовый пул имён пасса — заодно бесплатная реклама RobloxBank на чужом
 * опыте. Без мата и спецсимволов (иначе Roblox-фильтр заменит имя на «#####»).
 */
export const BRAND_GAMEPASS_NAMES = [
  "RobloxBank",
  "RobloxBank лучший",
  "RobloxBank любимый",
  "RobloxBank топ",
  "RobloxBank №1 по робуксам",
  "RobloxBank лучший магазин робуксов",
  "Робуксы тут — RobloxBank",
  "RobloxBank рекомендую",
];

/**
 * Имя пасса. Наше, не клиентское — поэтому это ещё и реклама RobloxBank: дефолт
 * берётся из брендового пула (случайно, для разнообразия объявлений). Явный
 * латиница/цифры/пробелы override уважаем (ручной случай админа); мат/кириллицу/
 * произвольный ввод не пускаем — вернём брендовое имя. `_priceInRobux` в
 * сигнатуре сохранён для совместимости и на случай ценового варианта названия.
 */
export function safeGamePassName(_priceInRobux: number, override?: string): string {
  const raw = (override ?? "").trim();
  if (raw && /^[A-Za-z0-9 ]{3,40}$/.test(raw)) return raw;
  return BRAND_GAMEPASS_NAMES[Math.floor(Math.random() * BRAND_GAMEPASS_NAMES.length)];
}

function isValidGamePassPrice(p: unknown): p is number {
  return typeof p === "number" && Number.isInteger(p) && p >= 1 && p <= 1_000_000;
}

/** placeId → universeId (эндпоинт уже используется в этом файле выше). */
async function placeToUniverseDirect(placeId: string | number): Promise<string | null> {
  try {
    const res = await rFetch(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
    if (!res.ok) return null;
    const data: any = await res.json().catch(() => null);
    return data?.universeId != null ? String(data.universeId) : null;
  } catch {
    return null;
  }
}

/** Публичные experience'ы аккаунта (universeId). Скрытый плейс здесь не появится. */
async function listUserUniverseIdsDirect(userId: number | string): Promise<string[]> {
  const out: string[] = [];
  try {
    const res = await rFetch(
      `https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=50`,
    );
    if (!res.ok) return out;
    const data: any = await res.json().catch(() => null);
    for (const g of data?.data ?? []) if (g?.id != null) out.push(String(g.id));
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * Кандидаты-universe в порядке приоритета: явный universeId → placeId → ник.
 * Скрытый плейс в публичном списке не появится — тогда нужен явный universeId/
 * placeId (клиент даёт ссылку на опыт).
 */
export async function resolveUniverseCandidatesDirect(
  params: Pick<CreateGamePassParams, "universeId" | "placeId" | "username">,
): Promise<string[]> {
  const cands: string[] = [];
  if (params.universeId != null) cands.push(String(params.universeId));
  if (params.placeId != null) {
    const u = await placeToUniverseDirect(params.placeId);
    if (u) cands.push(u);
  }
  if (params.username && params.username.trim()) {
    const userId = await resolveRobloxUserId(params.username.trim());
    if (userId != null) cands.push(...(await listUserUniverseIdsDirect(userId)));
  }
  return [...new Set(cands)];
}

/** Довести пасс до «в продаже» (PATCH, 204). Подстраховка на случай isForSale=false. */
async function patchGamePassOnSaleDirect(
  apiKey: string,
  universeId: string,
  gamePassId: number,
  priceInRobux: number,
): Promise<boolean> {
  const form = new FormData();
  form.append("request.IsForSale", "true");
  form.append("request.Price", String(priceInRobux));
  try {
    const res = await fetch(
      `${OPEN_CLOUD_GAMEPASS_BASE}/${universeId}/game-passes/${gamePassId}`,
      { method: "PATCH", headers: { "x-api-key": apiKey }, body: form },
    );
    return res.ok; // 204
  } catch {
    return false;
  }
}

/**
 * Создать покупаемый пасс на КОНКРЕТНОМ universe. Один POST (multipart), БЕЗ
 * авто-ретраев — создание не идемпотентно, повтор наплодил бы дубли. Отказы:
 * 401 → bad_key (протух/скопирован не целиком); 403 «Scope not authorized» →
 * bad_scope (ключ не на том API System, перебор не поможет); прочий 403 →
 * not_authorized (чужой опыт) → следующий кандидат.
 */
export async function createGamePassDirect(
  apiKey: string,
  universeId: string,
  name: string,
  priceInRobux: number,
): Promise<CreateGamePassResult> {
  const form = new FormData();
  form.append("request.Name", name);
  form.append("request.Description", "");
  form.append("request.Price", String(priceInRobux));
  form.append("request.IsForSale", "true");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${OPEN_CLOUD_GAMEPASS_BASE}/${universeId}/game-passes`, {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: form,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    // 401 = ключа нет/протух. У Open Cloud ключ живёт час, а покупатель легко
    // копирует его не целиком — это самая частая «ошибка», и звучать она должна
    // не как «Roblox вернул ошибку», а как «пришли ключ заново».
    if (res.status === 401) {
      return { ok: false, error: "bad_key", universeId, detail: "ключ не принят Roblox (протух или скопирован не полностью)" };
    }
    if (res.status === 403) {
      // «Scope not authorized» = ключ выпущен без `game-pass:write` (частая
      // ошибка клиента: выбран legacy-game-passes). Другие опыты не спасут.
      if (/scope not authorized/i.test(text)) {
        return {
          ok: false,
          error: "bad_scope",
          universeId,
          detail: "ключ без скоупа game-pass:write (нужен API System game-passes)",
        };
      }
      return { ok: false, error: "not_authorized", universeId, detail: "ключ не авторизован на этот experience" };
    }
    if (!res.ok) {
      return { ok: false, error: "roblox_error", universeId, detail: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* ignore */ }
    const gamePassId = Number(body?.gamePassId);
    if (!Number.isFinite(gamePassId)) {
      return { ok: false, error: "roblox_error", universeId, detail: `неожиданный ответ: ${text.slice(0, 300)}` };
    }
    let isForSale = Boolean(body?.isForSale);
    const returnedPrice = Number(body?.priceInformation?.defaultPriceInRobux ?? priceInRobux);
    if (!isForSale) isForSale = await patchGamePassOnSaleDirect(apiKey, universeId, gamePassId, priceInRobux);
    return {
      ok: true,
      gamePassId,
      universeId,
      priceInRobux: Number.isFinite(returnedPrice) ? returnedPrice : priceInRobux,
      isForSale,
      name: typeof body?.name === "string" ? body.name : name,
    };
  } catch (err: any) {
    return { ok: false, error: "network", universeId, detail: err?.message ?? String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Проверка ключа БЕЗ создания геймпасса — для личного кабинета.
 *
 * В кабинете ключ привязывают заранее, когда заказа ещё нет. Проверять его
 * созданием пасса нельзя: у покупателя на аккаунте останется мусор, который он
 * не заказывал. Поэтому обе операции проверяются своими безопасными запросами:
 *
 *   • `game-pass:read` — GET списка пассов опыта: ничего не меняет;
 *   • `game-pass:write` — PATCH НЕСУЩЕСТВУЮЩЕГО пасса: создать он не может по
 *     определению, а Roblox сначала проверяет права и только потом наличие.
 *     Права есть → «не найден» (404/400); прав нет → `403 Scope not authorized`.
 *
 * Именно так проверка отвечает на вопрос «ключ рабочий?» целиком: разрешение на
 * запись без пробы на запись — это обещание, которое вскроется на заказе.
 */
export interface VerifyGamePassKeyResult {
  ok: boolean;
  /** Опыт, на котором проверяли (он же — первый годный кандидат). */
  universeId?: string;
  /** Ник владельца, по которому резолвили опыт. */
  username?: string;
  /** Машинный код отказа — те же, что у создания. */
  error?: string;
  detail?: string;
}

/** Заведомо несуществующий id: пространство asset ID Roblox до него не доросло. */
const ABSENT_GAMEPASS_ID = 999_999_999_999;

export async function verifyGamePassKeyDirect(
  params: Pick<CreateGamePassParams, "apiKey" | "universeId" | "placeId" | "username">,
): Promise<VerifyGamePassKeyResult> {
  if (!params.apiKey || !params.apiKey.trim()) {
    return { ok: false, error: "bad_key", detail: "пустой ключ" };
  }
  const candidates = await resolveUniverseCandidatesDirect(params);
  if (candidates.length === 0) {
    return { ok: false, error: "no_universe", detail: "не удалось определить experience" };
  }

  let last: VerifyGamePassKeyResult | null = null;
  for (const universeId of candidates) {
    const read = await probeGamePassScope(params.apiKey, universeId, "read");
    if (read === "unauthorized") {
      // Опыт чужой для ключа — пробуем следующий: у аккаунта их бывает много.
      last = { ok: false, error: "not_authorized", universeId, detail: "ключ не авторизован на этот experience" };
      continue;
    }
    if (read === "bad_key") return { ok: false, error: "bad_key", universeId, detail: "Roblox не принял ключ" };
    if (read === "network") return { ok: false, error: "network", universeId, detail: "Roblox не ответил" };
    if (read === "no_scope") {
      return { ok: false, error: "bad_scope", universeId, detail: "у ключа нет game-pass:read" };
    }

    const write = await probeGamePassScope(params.apiKey, universeId, "write");
    if (write === "no_scope") {
      return { ok: false, error: "bad_scope_write", universeId, detail: "у ключа нет game-pass:write" };
    }
    if (write === "bad_key") return { ok: false, error: "bad_key", universeId };
    if (write === "network") return { ok: false, error: "network", universeId };
    // `unauthorized` на записи при прошедшем чтении — это не про права, а про
    // конкретный (несуществующий) пасс: считаем запись доступной.
    return { ok: true, universeId, username: params.username };
  }
  return last ?? { ok: false, error: "no_universe", detail: "нет кандидатов" };
}

type ScopeProbe = "ok" | "no_scope" | "bad_key" | "unauthorized" | "network";

async function probeGamePassScope(
  apiKey: string,
  universeId: string,
  op: "read" | "write",
): Promise<ScopeProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res: Response;
    if (op === "read") {
      res = await fetch(
        `${OPEN_CLOUD_GAMEPASS_BASE}/${universeId}/game-passes?passView=Full&pageSize=1`,
        { method: "GET", headers: { "x-api-key": apiKey }, signal: controller.signal },
      );
    } else {
      const form = new FormData();
      form.append("request.IsForSale", "true");
      form.append("request.Price", "100");
      res = await fetch(
        `${OPEN_CLOUD_GAMEPASS_BASE}/${universeId}/game-passes/${ABSENT_GAMEPASS_ID}`,
        { method: "PATCH", headers: { "x-api-key": apiKey }, body: form, signal: controller.signal },
      );
    }
    if (res.status === 401) return "bad_key";
    if (res.status === 403) {
      const text = await res.text().catch(() => "");
      return /scope not authorized/i.test(text) ? "no_scope" : "unauthorized";
    }
    // Для записи «404 не найден» — тоже успех: права проверены раньше наличия.
    return "ok";
  } catch {
    return "network";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Умеет ли ключ ЧИТАТЬ геймпассы этого опыта (`game-pass:read`).
 *
 * Нужен ровно для одного: различить две причины отказа по правам. Roblox на обе
 * отвечает одинаково — `403 Scope not authorized`, — а чинятся они по-разному:
 * выбран соседний `legacy-game-passes` (ключ не умеет вообще ничего) или в
 * рамке операций отмечена только одна строка из двух. Если чтение проходит, а
 * создание нет — значит не хватает именно `game-pass:write`, и человеку надо
 * сказать это, а не гонять его выпускать ключ заново.
 *
 * Вызывается ТОЛЬКО после отказа: на успешном пути лишних запросов нет.
 */
async function canReadGamePassesDirect(apiKey: string, universeId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${OPEN_CLOUD_GAMEPASS_BASE}/${universeId}/game-passes?passView=Full&pageSize=1`,
      { method: "GET", headers: { "x-api-key": apiKey } },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Оркестратор: резолв кандидатов-universe → создать на первом, где ключ
 * авторизован. 403 = «не тот universe» → следующий; иная ошибка → стоп.
 */
export async function createGamePassForUserDirect(
  params: CreateGamePassParams,
): Promise<CreateGamePassResult> {
  if (!params.apiKey || !params.apiKey.trim()) {
    return { ok: false, error: "roblox_error", detail: "пустой apiKey" };
  }
  if (!isValidGamePassPrice(params.priceInRobux)) {
    return { ok: false, error: "bad_price", detail: `цена вне диапазона: ${params.priceInRobux}` };
  }
  const name = safeGamePassName(params.priceInRobux, params.name);
  const candidates = await resolveUniverseCandidatesDirect(params);
  if (candidates.length === 0) {
    return {
      ok: false,
      error: "no_universe",
      detail: "не удалось определить experience (нужен universeId/placeId или публичный опыт по нику)",
    };
  }
  let last: CreateGamePassResult | null = null;
  for (const universeId of candidates) {
    const r = await createGamePassDirect(params.apiKey, universeId, name, params.priceInRobux);
    if (r.ok) return r;
    last = r;
    if (r.error !== "not_authorized") break; // bad_scope и прочее — дальше нет смысла
  }
  // Права: уточняем, какой именно операции не хватает. Обе ошибки приходят от
  // Roblox одинаковыми, а покупателю надо сказать разное.
  if (last?.error === "bad_scope" && last.universeId) {
    const canRead = await canReadGamePassesDirect(params.apiKey, last.universeId);
    if (canRead) {
      return {
        ...last,
        error: "bad_scope_write",
        detail: "у ключа есть game-pass:read, но нет game-pass:write",
      };
    }
  }
  return last ?? { ok: false, error: "no_universe", detail: "нет кандидатов" };
}

/**
 * Создание пасса так, как его запускают боты.
 *
 * ВК-бот живёт на RF-хосте, откуда `apis.roblox.com` молча висит (та же сеть
 * Roblox, что и у поиска по нику), а ТГ-бот — на SG, где Roblox доступен
 * напрямую. Поэтому маршрут тот же, что у `searchGamepassesByNickRouted`:
 * сначала мост, и только если он не отвечает — прямой путь.
 *
 * Отдельно от поиска: создание НЕ идемпотентно. Если мост ответил хоть чем-то
 * осмысленным (включая отказ Roblox), повторять его прямым вызовом нельзя —
 * так родились бы два пасса на один заказ. Фолбэк срабатывает только когда
 * мост недоступен как таковой (сеть, 401, 404 роута).
 */
export async function createGamePassForUserRouted(
  params: CreateGamePassParams,
): Promise<CreateGamePassResult> {
  const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();
  if (bridgeUrl) {
    const viaBridge = await createGamePassViaBridge(params, bridgeUrl, process.env.VALIDATOR_KEY?.trim());
    if (viaBridge !== BRIDGE_UNAVAILABLE) return viaBridge;
    console.warn("[Roblox/bots] Мост недоступен для create-gamepass — пробуем напрямую");
  }
  return createGamePassForUserDirect(params);
}

async function createGamePassViaBridge(
  params: CreateGamePassParams,
  bridgeUrl: string,
  bridgeKey: string | undefined,
): Promise<CreateGamePassResult | typeof BRIDGE_UNAVAILABLE> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(`${bridgeUrl.replace(/\/+$/, "")}/create-gamepass`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(bridgeKey ? { "x-validator-key": bridgeKey } : {}),
      },
      // Ключ уходит транзитом и НИКОГДА не печатается в лог — ни здесь, ни на мосту.
      body: JSON.stringify({
        apiKey: params.apiKey,
        priceInRobux: params.priceInRobux,
        name: params.name,
        universeId: params.universeId,
        placeId: params.placeId,
        username: params.username,
      }),
      signal: controller.signal,
    });
    if (res.status === 401) {
      console.error("[Roblox/bots] Мост ответил 401 на create-gamepass — сверить VALIDATOR_KEY с обеих сторон");
      return BRIDGE_UNAVAILABLE;
    }
    if (res.status === 404) {
      console.error("[Roblox/bots] Мост не знает /create-gamepass — версия моста старее ботов");
      return BRIDGE_UNAVAILABLE;
    }
    const body: any = await res.json().catch(() => null);
    if (!body || typeof body.ok !== "boolean") {
      console.warn(`[Roblox/bots] Мост вернул невнятный ответ на create-gamepass: HTTP ${res.status}`);
      return BRIDGE_UNAVAILABLE;
    }
    return body as CreateGamePassResult;
  } catch (err: any) {
    console.warn(`[Roblox/bots] Мост недоступен для create-gamepass: ${err?.message ?? err}`);
    return BRIDGE_UNAVAILABLE;
  } finally {
    clearTimeout(timer);
  }
}
