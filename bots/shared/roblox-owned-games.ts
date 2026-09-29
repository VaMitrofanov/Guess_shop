/* ─────────────────────────────────────────────────────────────────────────────
   Игры аккаунта Roblox — и публичные, и ЗАКРЫТЫЕ.

   Все поиски пассов по нику и выбор опыта для создания пасса по ключу раньше
   спрашивали у Roblox только публичные игры (`games?accessFilter=Public`).
   Закрытая игра туда не попадает, а закрыты по умолчанию и новые игры, и
   стартовый «<ник>'s Place». Итог: покупатель, сделавший всё правильно, слышал
   «не нашли твою игру». Замер 21.09.2026 по 52 застрявшим заказам: у 38 нет ни
   одной публичной игры, 11 из них уже выставили пасс, 9 — ровно по цене заказа.
   `accessFilter=All` Roblox не поддерживает (501).

   Рабочий путь без ключа и без cookie:
     1. `inventory.roblox.com/v2/users/{id}/inventory/9` — плейсы аккаунта,
        закрытые тоже (если инвентарь не спрятан настройками приватности);
     2. `apis.roblox.com/universes/v1/places/{placeId}/universe` — опыт плейса;
     3. `apis.roblox.com/game-passes/v1/universes/{id}/game-passes` — пассы
        опыта с живой ценой; для закрытого опыта отвечает так же.

   Чего этот путь не видит: инвентарь, закрытый настройками (403). Тогда мы
   честно говорим «не видим», а не «нет»: игра может быть, просто спрятана.

   Модуль без зависимостей — транспорт приходит снаружи. Им пользуются и боты
   (через свой `rFetch` с ретраями), и сайт (через свой `fetch`), чтобы правило
   «где искать игры» жило в одном месте.
   ───────────────────────────────────────────────────────────────────────── */

/** Ответ транспорта: `null` — сеть не ответила вовсе. */
export interface JsonResponse {
  ok: boolean;
  status: number;
  body: any;
}
export type JsonGet = (url: string) => Promise<JsonResponse | null>;

/**
 * Что мы знаем об играх аккаунта:
 *   ok     — хотя бы одна игра найдена;
 *   hidden — публичных игр нет, а инвентарь закрыт настройками приватности:
 *            игры могут быть, но мы их не видим;
 *   none   — Roblox ответил, и игр у аккаунта нет вовсе;
 *   error  — Roblox не ответил, вывод делать нельзя.
 */
export type GamesVisibility = "ok" | "hidden" | "none" | "error";

export interface OwnedUniverse {
  universeId: string;
  /** Плейс, через который нашли опыт; для публичной игры — корневой. */
  placeId: number;
  source: "public" | "inventory";
}

export interface OwnedGames {
  universes: OwnedUniverse[];
  visibility: GamesVisibility;
}

export interface UniversePass {
  id: number;
  productId: number;
  name: string;
  /** `null` у пасса, снятого с продажи. */
  price: number | null;
  isForSale: boolean;
  creatorName?: string;
  /** Когда пасс создан (мс эпохи), если Roblox сказал. */
  createdAt?: number;
  universeId: string;
  placeId: number;
}

const MAX_PUBLIC_PAGES = 3;
/** Больше плейсов у покупателя не бывает; предел защищает от чужих «ферм». */
const MAX_PLACES = 30;
const MAX_PASS_PAGES = 3;
const CONCURRENCY = 5;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Все опыты аккаунта: публичные из профиля плюс закрытые из инвентаря плейсов. */
export async function listOwnedUniverses(userId: number | string, get: JsonGet): Promise<OwnedGames> {
  const found = new Map<string, OwnedUniverse>();
  let publicAnswered = true;

  let cursor: string | null = null;
  for (let page = 0; page < MAX_PUBLIC_PAGES; page++) {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const res = await get(`https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=50${suffix}`);
    if (!res?.ok) {
      publicAnswered = false;
      break;
    }
    for (const game of res.body?.data ?? []) {
      if (game?.id == null) continue;
      const universeId = String(game.id);
      if (found.has(universeId)) continue;
      found.set(universeId, {
        universeId,
        placeId: Number(game.rootPlace?.id ?? game.rootPlaceId ?? 0),
        source: "public",
      });
    }
    cursor = res.body?.nextPageCursor ?? null;
    if (!cursor) break;
  }

  // Инвентарь плейсов: здесь и живут закрытые игры.
  let inventory: "visible" | "hidden" | "error" = "visible";
  let unresolvedPlaces = 0;
  const inv = await get(`https://inventory.roblox.com/v2/users/${userId}/inventory/9?limit=100&sortOrder=Desc`);
  if (!inv) inventory = "error";
  else if (inv.status === 403) inventory = "hidden";
  else if (!inv.ok) inventory = "error";
  else {
    const knownPlaces = new Set([...found.values()].map((u) => u.placeId));
    const placeIds = [
      ...new Set(
        ((inv.body?.data ?? []) as any[])
          .map((item) => Number(item?.assetId))
          .filter((id) => Number.isFinite(id) && id > 0 && !knownPlaces.has(id)),
      ),
    ].slice(0, MAX_PLACES);
    const resolved = await mapLimit(placeIds, CONCURRENCY, async (placeId) => {
      const res = await get(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
      const universeId = res?.ok ? res.body?.universeId : null;
      return universeId != null ? { universeId: String(universeId), placeId } : null;
    });
    for (const hit of resolved) {
      if (!hit) {
        unresolvedPlaces++;
        continue;
      }
      if (!found.has(hit.universeId)) {
        found.set(hit.universeId, { universeId: hit.universeId, placeId: hit.placeId, source: "inventory" });
      }
    }
  }

  const universes = [...found.values()];
  let visibility: GamesVisibility;
  if (universes.length > 0) visibility = "ok";
  // Инвентарь виден и пуст — значит плейсов нет совсем: публичная игра там
  // тоже лежала бы. Отказ публичного списка вывод не меняет.
  else if (inventory === "visible" && unresolvedPlaces === 0) visibility = "none";
  else if (inventory === "hidden" && publicAnswered) visibility = "hidden";
  else visibility = "error";
  return { universes, visibility };
}

/** Все пассы опытов с живыми ценами — и выставленные, и снятые с продажи. */
export async function listUniversePasses(universes: OwnedUniverse[], get: JsonGet): Promise<UniversePass[]> {
  const batches = await mapLimit(universes, CONCURRENCY, async (universe) => {
    const passes: UniversePass[] = [];
    let token: string | null = null;
    for (let page = 0; page < MAX_PASS_PAGES; page++) {
      const suffix = token ? `&pageToken=${encodeURIComponent(token)}` : "";
      const res = await get(
        `https://apis.roblox.com/game-passes/v1/universes/${universe.universeId}/game-passes?passView=Full&pageSize=100${suffix}`,
      );
      if (!res?.ok) break;
      for (const gp of res.body?.gamePasses ?? []) {
        const id = Number(gp?.id);
        if (!Number.isFinite(id) || id <= 0) continue;
        passes.push({
          id,
          productId: Number(gp.productId ?? 0),
          name: String(gp.name ?? gp.displayName ?? "Gamepass"),
          price: typeof gp.price === "number" ? gp.price : null,
          // Roblox иногда опускает поле у продающегося пасса — как и раньше,
          // «не сказано false» считаем «в продаже».
          isForSale: gp.isForSale !== false,
          creatorName: typeof gp.creator?.name === "string" ? gp.creator.name : undefined,
          createdAt: typeof gp.created === "string" && !Number.isNaN(Date.parse(gp.created)) ? Date.parse(gp.created) : undefined,
          universeId: universe.universeId,
          placeId: universe.placeId,
        });
      }
      token = res.body?.nextPageToken || null;
      if (!token) break;
    }
    return passes;
  });

  const seen = new Set<number>();
  return batches.flat().filter((pass) => {
    if (seen.has(pass.id)) return false;
    seen.add(pass.id);
    return true;
  });
}

/** Пасс, который можно выкупить: выставлен и с ненулевой ценой. */
export function isSellablePass(pass: Pick<UniversePass, "isForSale" | "price">): boolean {
  return pass.isForSale && (pass.price ?? 0) > 0;
}

/**
 * Ссылка на игру → её номер для движка создания пасса.
 *
 * Покупатель с закрытым инвентарём присылает адрес своей игры, и мы не гадаем:
 *   • Creator Hub: `create.roblox.com/dashboard/creations/experiences/{universeId}/…`
 *     — номер опыта прямо в адресе, это самый частый случай;
 *   • страница игры: `roblox.com/games/{placeId}/…` — номер плейса.
 * Голое число не принимаем: не понять, опыт это, плейс или пасс.
 */
export function parseExperienceRef(raw: string): { universeId: string } | { placeId: string } | null {
  const value = raw.trim();
  const universe = value.match(/experiences\/(\d{5,20})/i);
  if (universe) return { universeId: universe[1] };
  const place = value.match(/roblox\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?games\/(\d{5,20})/i);
  if (place) return { placeId: place[1] };
  return null;
}
