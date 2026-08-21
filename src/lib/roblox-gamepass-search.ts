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

  // Roblox paginates creations. A replacement search must not stop at the
  // first ten experiences: scan every page we can safely reach (150 max),
  // matching the bot-side implementation.
  const universes: any[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 3; page++) {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const gRes = await fetch(
      `https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=50${suffix}`,
      { headers: ROBLOX_UA, signal: AbortSignal.timeout(10_000) },
    ).catch(() => null);
    if (!gRes?.ok) return { status: "error" };
    const gData: any = await gRes.json().catch(() => null);
    universes.push(...(gData?.data ?? []));
    cursor = gData?.nextPageCursor ?? null;
    if (!cursor) break;
  }

  const batches = await Promise.all(universes.map(async (game: any) => {
    const pRes = await fetch(
      `https://apis.roblox.com/game-passes/v1/universes/${game.id}/game-passes?passView=Full&pageSize=100`,
      { headers: ROBLOX_UA, signal: AbortSignal.timeout(10_000) },
    ).catch(() => null);
    if (!pRes?.ok) return [];
    const pData: any = await pRes.json().catch(() => null);
    return (pData?.gamePasses ?? []) as any[];
  }));

  const seen = new Set<number>();
  const passes: ForSalePass[] = batches
    .flat()
    // Some Roblox responses omit isForSale for otherwise purchasable passes.
    .filter((gp: any) => gp.isForSale !== false && (gp.price ?? 0) > 0)
    .filter((gp: any) => {
      const id = Number(gp.id);
      if (!Number.isFinite(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((gp: any) => ({
      gamepassId: gp.id,
      name: gp.name ?? gp.displayName ?? "Gamepass",
      price: gp.price ?? 0,
    }));

  return { status: "ok", userId, resolvedName, passes };
}
