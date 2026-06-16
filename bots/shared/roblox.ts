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
      const uData = await uRes.json().catch(() => null);
      const universeId: number | undefined = uData?.universeId;
      if (universeId) {
        const [gRes, pRes] = await Promise.all([
          rFetch(`https://games.roblox.com/v1/games?universeIds=${universeId}`),
          rFetch(`https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes?passView=Full&pageSize=100`),
        ]);
        const gData  = gRes.ok  ? await gRes.json().catch(() => null)  : null;
        const pData  = pRes.ok  ? await pRes.json().catch(() => null)  : null;
        const placeId: number = gData?.data?.[0]?.rootPlaceId ?? 0;

        let gp = (pData?.gamePasses ?? []).find((p: any) => String(p.id) === String(gamepassId));

        // Try one more cursor page if not found in first 100
        if (!gp && pData?.nextPageCursor) {
          const p2Res = await rFetch(
            `https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes?passView=Full&pageSize=100&cursor=${encodeURIComponent(pData.nextPageCursor)}`
          ).catch(() => null);
          const p2Data = p2Res?.ok ? await p2Res.json().catch(() => null) : null;
          gp = (p2Data?.gamePasses ?? []).find((p: any) => String(p.id) === String(gamepassId));
        }

        if (gp) {
          const tRes = await rFetch(
            `https://thumbnails.roblox.com/v1/game-passes?gamePassIds=${gamepassId}&size=150x150&format=Png&isCircular=false`
          ).catch(() => null);
          const tData = tRes?.ok ? await tRes.json().catch(() => null) : null;
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
      const eData = await eRes.json().catch(() => null);
      creatorName = eData?.Creator?.Name ?? eData?.creatorName ?? null;
    }

    if (!creatorName) {
      const rRes = await rFetch(`https://apis.roproxy.com/game-passes/v1/game-passes/${gamepassId}/product-info`).catch(() => null);
      if (rRes?.ok) {
        const rData = await rRes.json().catch(() => null);
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
    const uData = await uRes.json().catch(() => null);
    const userId: number | undefined = uData?.data?.[0]?.id;
    return userId ?? null;
  } catch (err: any) {
    console.error("[Roblox/bots] resolveRobloxUserId:", err?.message ?? err);
    return null;
  }
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
  const gRes = await rFetch(
    `https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=10`
  );
  if (!gRes.ok) return [];
  const gData = await gRes.json().catch(() => null);
  const universes: any[] = gData?.data ?? [];
  if (universes.length === 0) {
    console.log(`[Roblox/bots] listForSaleGamepasses: no public games for userId=${userId}`);
    return [];
  }

  const passBatches = await Promise.all(universes.map(async (game: any) => {
    const placeId: number = game.rootPlaceId ?? game.rootPlace?.id ?? 0;
    const pRes = await rFetch(
      `https://apis.roblox.com/game-passes/v1/universes/${game.id}/game-passes?passView=Full&pageSize=30`
    ).catch(() => null);
    if (!pRes?.ok) return [];
    const pData = await pRes.json().catch(() => null);
    return (pData?.gamePasses ?? []).map((gp: any) => ({ ...gp, _placeId: placeId }));
  }));

  const all: any[] = passBatches.flat();
  if (all.length === 0) return [];

  const ids = all.map((gp: any) => gp.id).join(",");
  const tRes = await rFetch(
    `https://thumbnails.roblox.com/v1/game-passes?gamePassIds=${ids}&size=150x150&format=Png&isCircular=false`
  ).catch(() => null);
  const tData = tRes?.ok ? await tRes.json().catch(() => null) : null;
  const thumbMap: Record<number, string> = Object.fromEntries(
    (tData?.data ?? []).map((t: any) => [t.targetId, t.imageUrl])
  );

  return all
    .filter((gp: any) => gp.isForSale === true && (gp.price ?? 0) > 0)
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
