/**
 * Roblox API integration utilities.
 * All requests include User-Agent to avoid 403 blocks from server-side fetches.
 */

const UA = "Mozilla/5.0 (compatible; RobloxBank/1.0; +https://robloxbank.ru)";
const TIMEOUT_MS = 8_000;

function rFetch(url: string, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    headers: {
      "User-Agent": UA,
      "Accept": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export async function getRobloxUser(username: string) {
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
  try {
    const res = await rFetch(`https://users.roblox.com/v1/users/${userId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error("[Roblox] getRobloxUserById:", error);
    return null;
  }
}

export async function getGamepassDetails(gamepassId: string) {
  try {
    // Attempt 1: modern game-passes API
    const res1 = await rFetch(`https://apis.roblox.com/game-passes/v1/game-passes/${gamepassId}`);
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

    // Attempt 2: economy API (works from some server IPs)
    const res2 = await rFetch(`https://economy.roblox.com/v1/game-passes/${gamepassId}/details`);
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
          isActive:  d.IsForSale ?? false,
        };
      }
    }

    console.warn(`[Roblox] getGamepassDetails: all 4 APIs failed for id=${gamepassId}`);
    return null;
  } catch (error) {
    console.error("[Roblox] getGamepassDetails:", error);
    return null;
  }
}

export async function getGamepassById(gamepassId: string) {
  try {
    const details = await getGamepassDetails(gamepassId);
    if (!details) return null;

    const [thumbRes, creator] = await Promise.all([
      rFetch(`https://thumbnails.roblox.com/v1/game-passes?gamePassIds=${gamepassId}&size=150x150&format=Png&isCircular=false`),
      getRobloxUserById(String(details.creatorId)),
    ]);

    const thumbData  = thumbRes.ok ? await thumbRes.json() : { data: [] };
    const imageUrl   = thumbData.data?.[0]?.imageUrl
      ?? `https://www.roblox.com/asset-thumbnail/image?assetId=${gamepassId}&width=150&height=150&format=png`;
    const creatorName = creator?.name ?? creator?.requestedName ?? String(details.creatorId);

    return {
      id:          gamepassId,
      name:        details.name,
      price:       details.price,
      image:       imageUrl,
      creatorName,
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
      `https://games.roblox.com/v2/users/${user.id}/games?accessFilter=Public&limit=25&sortOrder=Desc`
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
      `https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes?passView=Full&pageSize=50`
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

export async function getUserGamepasses(username: string) {
  try {
    const user = await getRobloxUser(username);
    if (!user) return [];

    const userId = user.id;

    // 1. Fetch user's public games
    const gamesRes = await rFetch(
      `https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=10`
    );
    if (!gamesRes.ok) return [];

    const gamesData = await gamesRes.json();
    const universes: any[] = gamesData.data ?? [];
    if (universes.length === 0) return [];

    // 2. Fetch gamepasses for each universe in parallel
    const passPromises = universes.map(async (game: any) => {
      try {
        const res = await rFetch(
          `https://apis.roblox.com/game-passes/v1/universes/${game.id}/game-passes?passView=Full&pageSize=30`
        );
        if (!res.ok) return [];
        const data = await res.json();
        return data.gamePasses ?? [];
      } catch {
        return [];
      }
    });

    const allGamepasses: any[] = (await Promise.all(passPromises)).flat();
    if (allGamepasses.length === 0) return [];

    // 3. Batch-fetch thumbnails
    const ids = allGamepasses.map((gp: any) => gp.id).join(",");
    const thumbRes = await rFetch(
      `https://thumbnails.roblox.com/v1/game-passes?gamePassIds=${ids}&size=150x150&format=Png&isCircular=false`
    );
    const thumbData = thumbRes.ok ? await thumbRes.json() : { data: [] };
    const thumbMap  = Object.fromEntries(
      (thumbData.data ?? []).map((t: any) => [t.targetId, t.imageUrl])
    );

    return allGamepasses.map((gp: any) => ({
      id:        gp.id,
      name:      gp.name ?? gp.displayName,
      price:     gp.price ?? 0,
      productId: gp.productId,
      image:     thumbMap[gp.id]
        ?? `https://www.roblox.com/asset-thumbnail/image?assetId=${gp.id}&width=150&height=150&format=png`,
    }));
  } catch (error) {
    console.error("[Roblox] getUserGamepasses:", error);
    return [];
  }
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
