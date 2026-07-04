/**
 * Lean server-side «ник → for-sale геймпассы» для Web (зеркало
 * bots/shared/gamepass-search.ts, но без бот-зависимостей). Используется
 * GP-watch-кнопкой в TWA-карточке заказа (action `gpwatch-notify`).
 */

const ROBLOX_UA = { "User-Agent": "Roblox/WinInet", Accept: "application/json" };

export interface ForSalePass {
  gamepassId: number;
  name: string;
  price: number;
}

export type NickSearchResult =
  | { status: "user_not_found" }
  | { status: "error" }
  | { status: "ok"; userId: number; resolvedName: string; passes: ForSalePass[] };

export async function searchForSalePassesByNick(nick: string): Promise<NickSearchResult> {
  const uRes = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { ...ROBLOX_UA, "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [nick], excludeBannedUsers: true }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!uRes?.ok) return { status: "error" };
  const uData: any = await uRes.json().catch(() => null);
  const userId: number | undefined = uData?.data?.[0]?.id;
  if (!userId) return { status: "user_not_found" };
  const resolvedName: string = uData.data[0].name ?? nick;

  const gRes = await fetch(
    `https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=10`,
    { headers: ROBLOX_UA, signal: AbortSignal.timeout(10_000) },
  ).catch(() => null);
  if (!gRes?.ok) return { status: "error" };
  const gData: any = await gRes.json().catch(() => null);
  const universes: any[] = gData?.data ?? [];

  const batches = await Promise.all(universes.map(async (game: any) => {
    const pRes = await fetch(
      `https://apis.roblox.com/game-passes/v1/universes/${game.id}/game-passes?passView=Full&pageSize=30`,
      { headers: ROBLOX_UA, signal: AbortSignal.timeout(10_000) },
    ).catch(() => null);
    if (!pRes?.ok) return [];
    const pData: any = await pRes.json().catch(() => null);
    return (pData?.gamePasses ?? []) as any[];
  }));

  const passes: ForSalePass[] = batches
    .flat()
    .filter((gp: any) => gp.isForSale === true && (gp.price ?? 0) > 0)
    .map((gp: any) => ({
      gamepassId: gp.id,
      name: gp.name ?? gp.displayName ?? "Gamepass",
      price: gp.price ?? 0,
    }));

  return { status: "ok", userId, resolvedName, passes };
}
