/**
 * Utility functions for Roblox API integration.
 */

export async function getRobloxUser(username: string) {
  try {
    const res = await fetch(`https://users.roblox.com/v1/usernames/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernames: [username], excludeBannedUsers: true })
    });
    const data = await res.json();
    return data.data?.[0] || null;
  } catch (error) {
    console.error("Error fetching Roblox user:", error);
    return null;
  }
}

export async function getGamepassDetails(gamepassId: string) {
  try {
    // Primary: use the modern API
    const res = await fetch(`https://apis.roblox.com/game-passes/v1/game-passes/${gamepassId}`);
    if (res.ok) {
      const data = await res.json();
      return {
        id: data.id || gamepassId,
        name: data.name || data.displayName,
        price: data.price ?? 0,
        creatorId: data.sellerId || data.creatorId || 0,
        isActive: data.isForSale !== false,
      };
    }
    
    // Fallback: economy API (works with some IPs)
    const res2 = await fetch(`https://economy.roblox.com/v1/game-passes/${gamepassId}/details`);
    if (!res2.ok) return null;
    const data2 = await res2.json();
    return {
      id: data2.TargetId,
      name: data2.Name,
      price: data2.PriceInRobux,
      creatorId: data2.Creator?.Id || 0,
      isActive: data2.IsForSale,
    };
  } catch (error) {
    console.error("Error fetching Gamepass details:", error);
    return null;
  }
}

export async function getUserGamepasses(username: string) {
  try {
    const user = await getRobloxUser(username);
    if (!user) return [];

    const userId = user.id;
    
    // 1. Get user's public games (universes)
    const gamesRes = await fetch(`https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=10`);
    if (!gamesRes.ok) return [];
    
    const gamesData = await gamesRes.json();
    const universes = gamesData.data || [];
    
    if (universes.length === 0) return [];

    let allGamepasses: any[] = [];

    // 2. For each universe, fetch its gamepasses
    // We use Promise.all to fetch in parallel for speed
    const passPromises = universes.map(async (game: any) => {
      try {
        const universeId = game.id;
        // Replacement 2025 endpoint returns { "gamePasses": [...] }
        const res = await fetch(`https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes?passView=Full&pageSize=30`);
        if (!res.ok) return [];
        const data = await res.json();
        return data.gamePasses || [];
      } catch (e) {
        return [];
      }
    });

    const results = await Promise.all(passPromises);
    allGamepasses = results.flat();

    if (allGamepasses.length === 0) return [];

    // 3. Batch fetch thumbnails for ALL gamepasses for better performance
    const ids = allGamepasses.map(gp => gp.id).join(',');
    const thumbRes = await fetch(`https://thumbnails.roblox.com/v1/game-passes?gamePassIds=${ids}&size=150x150&format=Png&isCircular=false`);
    const thumbData = await thumbRes.ok ? await thumbRes.json() : { data: [] };
    const thumbMap = Object.fromEntries((thumbData.data || []).map((t: any) => [t.targetId, t.imageUrl]));

    return allGamepasses.map((gp: any) => ({
      id: gp.id,
      name: gp.name || gp.displayName,
      price: gp.price || 0,
      productId: gp.productId,
      image: thumbMap[gp.id] || `https://www.roblox.com/asset-thumbnail/image?assetId=${gp.id}&width=150&height=150&format=png`
    }));
  } catch (error) {
    console.error("Error fetching user gamepasses:", error);
    return [];
  }
}

export async function getGamepassById(gamepassId: string) {
  try {
    const details = await getGamepassDetails(gamepassId);
    if (!details) return null;

    // Get thumbnail for the single gamepass
    const thumbRes = await fetch(`https://thumbnails.roblox.com/v1/game-passes?gamePassIds=${gamepassId}&size=150x150&format=Png&isCircular=false`);
    const thumbData = await thumbRes.ok ? await thumbRes.json() : { data: [] };
    const imageUrl = thumbData.data?.[0]?.imageUrl || `https://www.roblox.com/asset-thumbnail/image?assetId=${gamepassId}&width=150&height=150&format=png`;

    const creator = await getRobloxUserById(details.creatorId.toString());

    return {
      id: gamepassId,
      name: details.name,
      price: details.price,
      image: imageUrl,
      creatorName: creator?.name || creator?.requestedName || details.creatorId.toString()
    };
  } catch (error) {
    console.error("Error fetching single gamepass:", error);
    return null;
  }
}

export async function verifyUserGamepass(username: string, gamepassId: string, requiredRobux: number) {
  const user = await getRobloxUser(username);
  if (!user) return { success: false, message: "User not found" };

  const gamepass = await getGamepassDetails(gamepassId);
  if (!gamepass) return { success: false, message: "Gamepass not found" };

  if (gamepass.creatorId !== user.id) {
    return { success: false, message: "Gamepass does not belong to this user" };
  }

  if (!gamepass.isActive) {
    return { success: false, message: "Gamepass is not for sale" };
  }

  // Roblox takes 30% tax, so users must set price higher to receive full amount.
  // But usually users set the price so they GET the amount.
  // The logic here depends on how the bot works. 
  // Let's assume the gamepass price must be around the expected robux + tax.
  
  return { success: true, user, gamepass };
}

export async function getRobloxUserById(userId: string) {
  try {
    const res = await fetch(`https://users.roblox.com/v1/users/${userId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data;
  } catch (error) {
    console.error("Error fetching Roblox user by ID:", error);
    return null;
  }
}
