/**
 * Lean server-side «ник → for-sale геймпассы» для Web (зеркало
 * bots/shared/gamepass-search.ts, но без бот-зависимостей). Используется
 * GP-watch-кнопкой в TWA-карточке заказа, автозаменой пасса при региональной
 * цене и подбором частей для разбитого выкупа.
 *
 * Ходит через мост первым (`VALIDATOR_SOURCE_URL`), прямой путь — фолбэк:
 * с RF-хоста API-хосты Roblox недостижимы по TCP, см. `src/lib/roblox-bridge.ts`.
 * Этот файл был пропущен при переводе поиска на мост 28.08 — на проде он молча
 * возвращал `error`, то есть автозамена пасса не работала вовсе.
 */

import { bridgeConfigured, bridgeSearchGamepasses } from "./roblox-bridge";
import {
  isSellablePass,
  listOwnedUniverses,
  listUniversePasses,
  type JsonGet,
} from "../../bots/shared/roblox-owned-games";

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
  if (bridgeConfigured()) {
    const viaBridge = await bridgeSearchGamepasses(nick);
    if (viaBridge) {
      if (!viaBridge.userExists) return { status: "user_not_found" };
      const account = viaBridge.account;
      return {
        status: "ok",
        userId: Number(account?.id ?? 0),
        resolvedName: account?.name ?? nick,
        // Мост уже отфильтровал снятые с продажи и бесплатные пассы тем же
        // правилом, что и прямая ветка ниже.
        passes: viaBridge.gamepasses.map((p) => ({
          gamepassId: Number(p.gamepassId),
          name: p.name,
          price: Number(p.robux) || 0,
        })),
      };
    }
  }
  return searchForSalePassesByNickDirect(nick);
}

async function searchForSalePassesByNickDirect(nick: string): Promise<NickSearchResult> {
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

  // Все игры аккаунта — публичные И закрытые (`roblox-owned-games.ts`): пасс
  // в закрытой игре продаётся так же, а автозамена его раньше не видела.
  const getJson: JsonGet = async (url) => {
    const res = await fetch(url, { headers: ROBLOX_UA, signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!res) return null;
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  };
  const owned = await listOwnedUniverses(userId, getJson);
  if (owned.visibility === "error") return { status: "error" };

  const passes: ForSalePass[] = (await listUniversePasses(owned.universes, getJson))
    .filter(isSellablePass)
    .map((gp) => ({ gamepassId: gp.id, name: gp.name, price: gp.price ?? 0 }));

  return { status: "ok", userId, resolvedName, passes };
}
