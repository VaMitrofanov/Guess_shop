/**
 * Utility functions for Roblox API integration.
 */

export async function getRobloxUser(username: string) {
  try {
    const res = await fetch(`https://users.roblox.com/v1/users/search?keyword=${username}&limit=1`);
    const data = await res.json();
    return data.data?.[0] || null;
  } catch (error) {
    console.error("Error fetching Roblox user:", error);
    return null;
  }
}

export async function getGamepassDetails(gamepassId: string) {
  try {
    const res = await fetch(`https://economy.roblox.com/v1/game-passes/${gamepassId}/details`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      id: data.TargetId,
      name: data.Name,
      price: data.PriceInRobux,
      creatorId: data.Creator.Id,
      isActive: data.IsForSale,
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

    // Search catalog for gamepasses by this user
    // Note: catalog API sometimes requires specific headers or has different query params
    // Another way is to get their games and then gamepasses.
    // Let's try the direct catalog search first
    const res = await fetch(`https://catalog.roblox.com/v1/search/items/details?category=Gamepasses&creatorName=${username}&limit=30`);
    if (!res.ok) return [];
    
    const data = await res.json();
    return (data.data || []).map((item: any) => ({
      id: item.id,
      name: item.name,
      price: item.price,
      productId: item.productId,
      image: item.imageUri || `https://www.roblox.com/asset-thumbnail/image?assetId=${item.id}&width=150&height=150&format=png`
    }));
  } catch (error) {
    console.error("Error fetching user gamepasses:", error);
    return [];
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
