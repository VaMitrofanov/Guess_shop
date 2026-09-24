/**
 * Roblox API integration utilities.
 * All requests include User-Agent to avoid 403 blocks from server-side fetches.
 *
 * Порядок источников: сначала сингапурский мост (`VALIDATOR_SOURCE_URL`), потом
 * прямые запросы. С российского хоста прямой путь до API-хостов Roblox не
 * работает вообще — подробности и симптомы в `src/lib/roblox-bridge.ts`. Там,
 * где моста нет (локальная разработка, SG-хосты, тесты), всё идёт как раньше.
 */

import {
  bridgeConfigured,
  bridgeGamepassById,
  bridgeGamepassDetails,
  bridgeRobloxUser,
  bridgeSearchGamepasses,
  type BridgeAccount,
  type BridgePass,
} from "./roblox-bridge";
import {
  listOwnedUniverses,
  listUniversePasses,
  type GamesVisibility,
  type JsonGet,
} from "../../bots/shared/roblox-owned-games";

const UA = "Mozilla/5.0 (compatible; RobloxBank/1.0; +https://robloxbank.ru)";
const TIMEOUT_MS = 8_000;

async function rFetch(url: string, init: RequestInit = {}) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        cache: init.cache ?? "no-store",
        headers: {
          "User-Agent": UA,
          "Accept": "application/json",
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status !== 429 && response.status < 500) return response;
      lastError = new Error(`Roblox HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 150));
  }
  throw lastError instanceof Error ? lastError : new Error("Roblox request failed");
}

/** JSON через `rFetch` для общего поиска игр; `null` — сеть не ответила. */
const getJson: JsonGet = async (url) => {
  try {
    const res = await rFetch(url);
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return null;
  }
};

/**
 * Мост отдаёт нормализованный профиль, а вызывающий код здесь исторически
 * читает сырой ответ Roblox (`name`/`displayName`/`id`). Приводим к нему, чтобы
 * переключение источника не потребовало трогать ни один вызов.
 */
function toRobloxUserShape(account: BridgeAccount) {
  return {
    id: Number(account.id),
    name: account.name,
    displayName: account.displayName,
    requestedName: account.name,
    avatarUrl: account.avatarUrl,
    description: account.description ?? null,
    created: account.created ?? null,
  };
}

export async function getRobloxUser(username: string) {
  if (bridgeConfigured()) {
    const viaBridge = await bridgeRobloxUser({ username });
    if (viaBridge) return toRobloxUserShape(viaBridge);
  }
  return getRobloxUserDirect(username);
}

async function getRobloxUserDirect(username: string) {
  try {
    const res = await rFetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0] || null;
  } catch (error) {
    console.error("[Roblox] getRobloxUser:", error);
    return null;
  }
}

export async function getRobloxUserById(userId: string) {
  if (bridgeConfigured()) {
    const viaBridge = await bridgeRobloxUser({ userId });
    if (viaBridge) return toRobloxUserShape(viaBridge);
  }
  try {
    const res = await rFetch(`https://users.roblox.com/v1/users/${userId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error("[Roblox] getRobloxUserById:", error);
    return null;
  }
}

export async function getRobloxAvatar(userId: string | number) {
  if (bridgeConfigured()) {
    const viaBridge = await bridgeRobloxUser({ userId });
    if (viaBridge) return viaBridge.avatarUrl;
  }
  return getRobloxAvatarDirect(userId);
}

async function getRobloxAvatarDirect(userId: string | number): Promise<string | null> {
  try {
    const res = await rFetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=true`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[0]?.imageUrl ?? null;
  } catch (error) {
    console.error("[Roblox] getRobloxAvatar:", error);
    return null;
  }
}

export type RobloxPublicProfile = {
  id: string;
  username: string;
  displayName: string;
  description: string | null;
  createdAt: string | null;
  avatarUrl: string | null;
  profileUrl: string;
};

async function hydrateRobloxPublicProfile(user: Record<string, unknown>): Promise<RobloxPublicProfile | null> {
  const id = String(user.id ?? "").trim();
  const username = String(user.name ?? user.requestedName ?? "").trim();
  if (!id || !username) return null;
  const avatarUrl = await getRobloxAvatar(id);
  return {
    id,
    username,
    displayName: String(user.displayName ?? username),
    description: typeof user.description === "string" ? user.description : null,
    createdAt: typeof user.created === "string" ? user.created : null,
    avatarUrl,
    profileUrl: `https://www.roblox.com/users/${encodeURIComponent(id)}/profile`,
  };
}

/** Public profile only: no visitor cookie, Roblox password or private inventory. */
export async function getRobloxPublicProfile(username: string): Promise<RobloxPublicProfile | null> {
  const basic = await getRobloxUser(username);
  if (!basic?.id) return null;
  const detailed = await getRobloxUserById(String(basic.id));
  return hydrateRobloxPublicProfile((detailed ?? basic) as Record<string, unknown>);
}

/** Stable-ID refresh survives a Roblox username change. */
export async function getRobloxPublicProfileById(userId: string): Promise<RobloxPublicProfile | null> {
  const detailed = await getRobloxUserById(userId);
  if (!detailed) return null;
  return hydrateRobloxPublicProfile(detailed as Record<string, unknown>);
}

export async function getGamepassDetails(gamepassId: string) {
  if (bridgeConfigured()) {
    const viaBridge = await bridgeGamepassDetails(gamepassId);
    if (viaBridge) {
      return {
        id:          String(viaBridge.id ?? gamepassId),
        name:        viaBridge.name ?? "Gamepass",
        price:       viaBridge.price ?? 0,
        creatorId:   viaBridge.creatorId ?? 0,
        creatorName: viaBridge.creatorName,
        isActive:    viaBridge.isActive !== false,
      };
    }
  }
  try {
    // Attempt 0: product-info — ЕДИНСТВЕННЫЙ живой источник по одному пассу.
    //
    // Проверено с прод-хоста 24.08.2026 на живом геймпассе: `game-passes/v1/
    // game-passes/<id>` → 404, `economy…/details` → 404, `catalog/items/details`
    // → 403 «XSRF token invalid», `api.roblox.com/marketplace` мёртв давно.
    // Из-за этого поиск по НИКУ работал (он ходит в другой эндпоинт —
    // `universes/<id>/game-passes`), а поиск по ССЫЛКЕ/ID молча отдавал пусто,
    // и серверная ре-валидация в select-gamepass всё время шла по ветке
    // «Roblox недоступен». Этот эндпоинт отдаёт всё нужное разом, включая имя
    // владельца — второй запрос за ником больше не нужен. Тот же эндпоинт
    // использует бот (`getGamepassProductInfo`).
    const res0 = await rFetch(`https://apis.roblox.com/game-passes/v1/game-passes/${gamepassId}/product-info`);
    if (res0.ok) {
      const d = await res0.json();
      if (d?.TargetId) {
        return {
          id:          String(d.TargetId),
          name:        d.Name ?? "Gamepass",
          // У снятого с продажи пасса PriceInRobux = null.
          price:       d.PriceInRobux ?? 0,
          creatorId:   d.Creator?.Id ?? d.Creator?.CreatorTargetId ?? 0,
          creatorName: typeof d.Creator?.Name === "string" ? d.Creator.Name : undefined,
          isActive:    d.IsForSale !== false,
        };
      }
    }

    // Attempt 1: modern game-passes API
    const res1 = await rFetch(`https://apis.roblox.com/game-passes/v1/game-passes/${gamepassId}`);
    if (res1.ok) {
      const d = await res1.json();
      return {
        id:        String(d.id ?? gamepassId),
        name:      d.name ?? d.displayName ?? "Gamepass",
        price:     d.price ?? 0,
        creatorId: d.sellerId ?? d.creatorId ?? 0,
        creatorName: undefined as string | undefined,
        isActive:  d.isForSale !== false,
      };
    }

    // Attempt 2: economy API (works from some server IPs)
    const res2 = await rFetch(`https://economy.roblox.com/v1/game-passes/${gamepassId}/details`);
    if (res2.ok) {
      const d = await res2.json();
      return {
        id:        String(d.TargetId ?? gamepassId),
        name:      d.Name ?? "Gamepass",
        price:     d.PriceInRobux ?? 0,
        creatorId: d.Creator?.Id ?? 0,
        creatorName: typeof d.Creator?.Name === "string" ? d.Creator.Name : undefined,
        isActive:  d.IsForSale ?? false,
      };
    }

    // Attempt 3: catalog details endpoint (broader coverage)
    const res3 = await rFetch("https://catalog.roblox.com/v1/catalog/items/details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ itemType: "GamePass", id: Number(gamepassId) }] }),
    });
    if (res3.ok) {
      const d = await res3.json();
      const item = d.data?.[0];
      if (item) {
        return {
          id:        String(gamepassId),
          name:      item.name ?? "Gamepass",
          price:     item.lowestPrice ?? item.price ?? 0,
          creatorId: item.creatorTargetId ?? 0,
          creatorName: typeof item.creatorName === "string" ? item.creatorName : undefined,
          isActive:  item.itemStatus !== "Offsale",
        };
      }
    }

    // Attempt 4: legacy marketplace productinfo API
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
          creatorName: typeof d.Creator?.Name === "string" ? d.Creator.Name : undefined,
          isActive:  d.IsForSale ?? false,
        };
      }
    }

    console.warn(`[Roblox] getGamepassDetails: all 5 APIs failed for id=${gamepassId}`);
    return null;
  } catch (error) {
    console.error("[Roblox] getGamepassDetails:", error);
    return null;
  }
}

export async function getGamepassById(gamepassId: string) {
  if (bridgeConfigured()) {
    const viaBridge = await bridgeGamepassById(gamepassId);
    // Владелец и состояние продажи живут в `details`, а картинка и placeId — в
    // `pass`. Без `details` карточку не собрать: сайт обязан показать «снят с
    // продажи» вместо тихого «не подходит», а гард заказа — сверить владельца.
    if (viaBridge?.details) {
      const { pass, details } = viaBridge;
      return {
        id:          gamepassId,
        name:        details.name ?? pass?.name ?? "Gamepass",
        price:       details.price ?? pass?.robux ?? 0,
        creatorId:   details.creatorId ?? 0,
        image:       pass?.image
          ?? `https://www.roblox.com/asset-thumbnail/image?assetId=${gamepassId}&width=150&height=150&format=png`,
        creatorName: details.creatorName ?? pass?.sellerName ?? String(details.creatorId ?? ""),
        isForSale:   details.isActive !== false,
      };
    }
  }
  try {
    const details = await getGamepassDetails(gamepassId);
    if (!details) return null;

    // product-info уже принёс имя владельца — добираем его отдельным запросом
    // только когда пасс пришёл из фолбэк-ветки без `creatorName`.
    const [thumbRes, creator] = await Promise.all([
      rFetch(`https://thumbnails.roblox.com/v1/game-passes?gamePassIds=${gamepassId}&size=150x150&format=Png&isCircular=false`),
      details.creatorName ? Promise.resolve(null) : getRobloxUserById(String(details.creatorId)),
    ]);

    const thumbData  = thumbRes.ok ? await thumbRes.json() : { data: [] };
    const imageUrl   = thumbData.data?.[0]?.imageUrl
      ?? `https://www.roblox.com/asset-thumbnail/image?assetId=${gamepassId}&width=150&height=150&format=png`;
    const creatorName = details.creatorName ?? creator?.name ?? creator?.requestedName ?? String(details.creatorId);

    return {
      id:          gamepassId,
      name:        details.name,
      price:       details.price,
      creatorId:   details.creatorId,
      image:       imageUrl,
      creatorName,
      // Ручной ввод ссылки должен уметь сказать «пасс снят с продажи» вместо
      // молчаливого «не подходит»: `isActive` — единственный признак продажи,
      // который отдают все четыре источника в getGamepassDetails.
      isForSale:   details.isActive !== false,
    };
  } catch (error) {
    console.error("[Roblox] getGamepassById:", error);
    return null;
  }
}

/** Returns public games (universes) for a given username */
export async function getUserGames(username: string) {
  try {
    const user = await getRobloxUser(username);
    if (!user) return [];

    const res = await rFetch(
      `https://games.roblox.com/v2/users/${user.id}/games?accessFilter=Public&limit=50&sortOrder=Desc`
    );
    if (!res.ok) return [];

    const data = await res.json();
    const universes: any[] = data.data ?? [];
    if (universes.length === 0) return [];

    // Batch-fetch game icons
    const ids = universes.map((g: any) => g.id).join(",");
    const thumbRes = await rFetch(
      `https://thumbnails.roblox.com/v1/games/icons?universeIds=${ids}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`
    );
    const thumbData = thumbRes.ok ? await thumbRes.json() : { data: [] };
    const thumbMap = Object.fromEntries(
      (thumbData.data ?? []).map((t: any) => [String(t.targetId), t.imageUrl])
    );

    return universes.map((game: any) => ({
      universeId: String(game.id),
      rootPlaceId: game.rootPlaceId,
      name: game.name ?? "Game",
      image: thumbMap[String(game.id)] ?? null,
    }));
  } catch (error) {
    console.error("[Roblox] getUserGames:", error);
    return [];
  }
}

/** Returns gamepasses for a specific universe ID */
export async function getUniverseGamepasses(universeId: string) {
  try {
    const res = await rFetch(
      `https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes?passView=Full&pageSize=100`
    );
    if (!res.ok) return [];

    const data = await res.json();
    const passes: any[] = data.gamePasses ?? [];
    if (passes.length === 0) return [];

    // Batch thumbnails
    const ids = passes.map((gp: any) => gp.id).join(",");
    const thumbRes = await rFetch(
      `https://thumbnails.roblox.com/v1/game-passes?gamePassIds=${ids}&size=150x150&format=Png&isCircular=false`
    );
    const thumbData = thumbRes.ok ? await thumbRes.json() : { data: [] };
    const thumbMap = Object.fromEntries(
      (thumbData.data ?? []).map((t: any) => [t.targetId, t.imageUrl])
    );

    return passes.map((gp: any) => ({
      id: gp.id,
      name: gp.name ?? gp.displayName,
      price: gp.price ?? 0,
      productId: gp.productId,
      image:
        thumbMap[gp.id] ??
        `https://www.roblox.com/asset-thumbnail/image?assetId=${gp.id}&width=150&height=150&format=png`,
    }));
  } catch (error) {
    console.error("[Roblox] getUniverseGamepasses:", error);
    return [];
  }
}

export async function getUserGamepasses(username: string, resolvedUserId?: string | number) {
  if (bridgeConfigured()) {
    const viaBridge = await bridgeSearchGamepasses(username);
    if (viaBridge) return viaBridge.gamepasses.map((pass) => toSitePassShape(pass, username));
  }
  return getUserGamepassesDirect(username, resolvedUserId);
}

async function getUserGamepassesDirect(username: string, resolvedUserId?: string | number) {
  return (await getUserGamepassesWithGamesDirect(username, resolvedUserId)).gamepasses;
}

/**
 * Пассы всех игр аккаунта — публичных и закрытых (`roblox-owned-games.ts`).
 * Тот же путь, что у моста: правило «где искать игры» живёт в одном месте.
 */
async function getUserGamepassesWithGamesDirect(username: string, resolvedUserId?: string | number) {
  const empty = { gamepasses: [] as SitePass[], games: null as NickGames | null };
  try {
    const userId = resolvedUserId ?? (await getRobloxUser(username))?.id;
    if (!userId) return empty;

    const owned = await listOwnedUniverses(userId, getJson);
    const games: NickGames = { visibility: owned.visibility, count: owned.universes.length };
    if (owned.universes.length === 0) return { gamepasses: [] as SitePass[], games };

    const allGamepasses = await listUniversePasses(owned.universes, getJson);
    if (allGamepasses.length === 0) return { gamepasses: [] as SitePass[], games };

    const ids = allGamepasses.map((gp) => gp.id).join(",");
    const thumbRes = await rFetch(
      `https://thumbnails.roblox.com/v1/game-passes?gamePassIds=${ids}&size=150x150&format=Png&isCircular=false`
    ).catch(() => null);
    const thumbData = thumbRes?.ok ? await thumbRes.json() : { data: [] };
    const thumbMap  = Object.fromEntries(
      (thumbData.data ?? []).map((t: any) => [t.targetId, t.imageUrl])
    );

    const gamepasses: SitePass[] = allGamepasses.map((gp) => ({
      id:         gp.id,
      name:       gp.name,
      price:      gp.price ?? 0,
      productId:  gp.productId,
      placeId:    gp.placeId,
      sellerName: gp.creatorName ?? username,
      isForSale:  gp.isForSale,
      image:      thumbMap[gp.id]
        ?? `https://www.roblox.com/asset-thumbnail/image?assetId=${gp.id}&width=150&height=150&format=png`,
    }));
    return { gamepasses, games };
  } catch (error) {
    console.error("[Roblox] getUserGamepasses:", error);
    return empty;
  }
}

type SitePass = {
  id: number;
  name: string;
  price: number;
  productId: number;
  placeId: number;
  sellerName: string;
  isForSale: boolean;
  image: string;
};

type NickGames = { visibility: GamesVisibility; count: number };

/**
 * Мост отдаёт пасс в терминах бота (`gamepassId`/`robux`), витрина читает свои
 * (`id`/`price`). Одна точка перевода на оба вызова, чтобы поля не разъехались.
 *
 * `isForSale: true` не догадка: мост отдаёт только продающиеся платные пассы —
 * тем же правилом, что и `rankSellableGamepasses` на витрине.
 */
function toSitePassShape(pass: BridgePass, fallbackSeller: string) {
  return {
    id:         pass.gamepassId,
    name:       pass.name,
    price:      pass.robux,
    productId:  pass.productId ?? 0,
    placeId:    pass.placeId ?? 0,
    sellerName: pass.sellerName || fallbackSeller,
    isForSale:  true,
    image:      pass.image
      ?? `https://www.roblox.com/asset-thumbnail/image?assetId=${pass.gamepassId}&width=150&height=150&format=png`,
  };
}

export type NickSearchResult = {
  /** `false` — Roblox ответил, что такого ника нет. Опечатка покупателя. */
  userExists: boolean;
  account: { id: string; username: string; displayName: string; avatarUrl: string | null } | null;
  gamepasses: Awaited<ReturnType<typeof getUserGamepasses>>;
  /**
   * Видны ли игры аккаунта. Пустой список пассов при `hidden` — «не видим»
   * (инвентарь закрыт), при `none` — «игр нет», при `ok` — «игры есть, пасса
   * в продаже нет». `null` — старый мост, различить нельзя.
   */
  games: NickGames | null;
};

/**
 * Поиск по нику одним походом наружу.
 *
 * Раньше страница резолвила аккаунт, потом отдельно тянула пассы, потом ещё
 * аватар — три круга по одному и тому же маршруту. Через мост это три RTT, а
 * при недоступном Roblox — три полных бюджета ретраев подряд, и покупатель
 * ждал десятки секунд ради ответа «не нашли».
 *
 * Разделение `userExists` и пустого списка держим намеренно: «такого ника нет»
 * покупатель чинит опечаткой, а «аккаунт есть, пассов не видно» — вставкой
 * ссылки на геймпасс, потому что это, как правило, скрытый плейс.
 */
export async function searchGamepassesByNick(nick: string): Promise<NickSearchResult> {
  const username = nick.trim();
  if (bridgeConfigured()) {
    const viaBridge = await bridgeSearchGamepasses(username);
    if (viaBridge) {
      // `account` приходит только от моста, знающего про `/roblox-user`. Старый
      // мост отдаёт один список пассов — и он сам по себе доказывает, что
      // аккаунт есть. Требовать здесь карточку аккаунта значило бы отвечать
      // «такого ника нет» на успешный поиск, пока выкатка идёт не в том порядке.
      const account = viaBridge.account;
      return {
        userExists: viaBridge.userExists,
        account: account
          ? { id: account.id, username: account.name, displayName: account.displayName, avatarUrl: account.avatarUrl }
          : null,
        gamepasses: viaBridge.gamepasses.map((pass) => toSitePassShape(pass, username)),
        games: viaBridge.games,
      };
    }
  }

  // Сюда попадаем либо без моста, либо когда он уже не ответил — второй раз
  // стучаться в него на каждом из трёх вызовов значит утроить ожидание ровно
  // в тот момент, когда покупатель и так ждёт дольше всего.
  const user = await getRobloxUserDirect(username);
  if (!user?.id) return { userExists: false, account: null, gamepasses: [], games: null };
  const resolvedName = String(user.name ?? username);
  const [{ gamepasses, games }, avatarUrl] = await Promise.all([
    getUserGamepassesWithGamesDirect(resolvedName, user.id),
    getRobloxAvatarDirect(user.id),
  ]);
  return {
    userExists: true,
    account: {
      id: String(user.id),
      username: resolvedName,
      displayName: String(user.displayName ?? resolvedName),
      avatarUrl,
    },
    gamepasses,
    games,
  };
}

type CheckoutGamepass = {
  id: string;
  name: string;
  price: number;
  creatorId: number;
  /** Владелец пасса — ему уйдут робуксы; получатель заказа берётся отсюда. */
  creatorName?: string;
  isActive: boolean;
};

type ListedGamepass = {
  id: string | number;
  name?: string;
  price?: number;
  isForSale?: boolean;
};

/**
 * Resolves a pass immediately before a web payment is created.
 *
 * Roblox's item-detail endpoints are intermittently unavailable from some
 * server IP ranges, while the public universe listing used by the checkout
 * search still returns the same pass. A successful fallback is deliberately
 * restricted to the requested Roblox owner's current public pass list, so it
 * cannot weaken the ownership, sale-state or price checks in the order guard.
 */
export async function getCheckoutGamepassDetails(
  gamepassId: string,
  owner: { id: string | number; username: string },
  dependencies: {
    getDirect?: (id: string) => Promise<CheckoutGamepass | null>;
    listOwned?: (username: string, userId: string | number) => Promise<ListedGamepass[]>;
  } = {},
): Promise<CheckoutGamepass | null> {
  const direct = await (dependencies.getDirect ?? getGamepassDetails)(gamepassId);
  if (direct) return direct;

  const ownedPasses = await (dependencies.listOwned ?? getUserGamepasses)(owner.username, owner.id);
  const listedPass = ownedPasses.find((pass) => String(pass.id) === String(gamepassId));
  if (!listedPass) return null;

  return {
    id: String(listedPass.id),
    name: listedPass.name ?? "Gamepass",
    price: Number(listedPass.price ?? 0),
    creatorId: Number(owner.id),
    creatorName: owner.username,
    isActive: listedPass.isForSale === true,
  };
}

export async function verifyUserGamepass(username: string, gamepassId: string, _requiredRobux: number) {
  const user = await getRobloxUser(username);
  if (!user) return { success: false, message: "User not found" };

  const gamepass = await getGamepassDetails(gamepassId);
  if (!gamepass) return { success: false, message: "Gamepass not found" };

  if (String(gamepass.creatorId) !== String(user.id)) {
    return { success: false, message: "Gamepass does not belong to this user" };
  }

  if (!gamepass.isActive) {
    return { success: false, message: "Gamepass is not for sale" };
  }

  return { success: true, user, gamepass };
}
