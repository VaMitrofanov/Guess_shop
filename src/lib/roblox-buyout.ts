export const ROBLOX_UA = { "User-Agent": "Roblox/WinInet", Accept: "application/json" };

export class BuyoutError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "BuyoutError";
    this.status = status;
  }
}

export interface ResolvedGamepass {
  gamepassId: number;
  productId: number;
  name: string;
  price: number;
  sellerName: string;
  sellerId: number;
  isForSale: boolean;
  isManagedPricing: boolean;
  basePriceInRobux: number;
  image: string | null;
}

/**
 * Классификация неуспешной покупки у источника (по HTTP-статусу и каноничному
 * `reason` Roblox, а не по итоговому локализованному msg):
 * - internal — наша проблема (cookie, Robux донора): ретрай уместен, продавца не касается;
 * - row      — проблема геймпасса/строки (цена сменилась, не продаётся): исправляет партнёр;
 * - unknown  — не классифицировано, трактовать консервативно (не вешать на партнёра).
 */
export type PurchaseFailureKind = "internal" | "row" | "unknown";

export interface PurchaseResult {
  success: boolean;
  msg: string;
  price?: number;
  balance: number | null;
  alreadyOwned?: boolean;
  /** Ф1: покупка провалилась по ответу Roblox, но владение подтвердилось проверкой. */
  recovered?: boolean;
  failureKind?: PurchaseFailureKind;
}

type RobloxProductInfo = {
  ProductId?: number;
  PriceInRobux?: number;
  UserBasePriceInRobux?: number;
  Name?: string;
  Creator?: {
    Name?: string;
    Id?: number;
    CreatorTargetId?: number;
  };
  IsForSale?: boolean;
};

type RobloxThumbnailResponse = {
  data?: Array<{ imageUrl?: string }>;
};

type RobloxBalanceResponse = {
  robux?: number;
};

type RobloxPurchaseResponse = {
  purchased?: boolean;
  reason?: string;
  errorMsg?: string;
  price?: number;
};

export function parseGamepassId(raw: string): string | null {
  const value = String(raw ?? "").trim();
  return (
    value.match(/game-pass(?:es)?\/(\d+)/i)?.[1] ??
    value.match(/[?&]gamepassId=(\d+)/i)?.[1] ??
    value.match(/^\d+$/)?.[0] ??
    value.match(/(\d{4,})/)?.[1] ??
    null
  );
}

export async function resolveGamepass(raw: string): Promise<ResolvedGamepass> {
  const gpId = parseGamepassId(raw);
  if (!gpId) throw new BuyoutError("Невалидный ID геймпасса", 400);

  const infoUrls = [
    `https://apis.roblox.com/game-passes/v1/game-passes/${gpId}/product-info`,
    `https://apis.roproxy.com/game-passes/v1/game-passes/${gpId}/product-info`,
  ];
  let info: RobloxProductInfo | null = null;
  for (const url of infoUrls) {
    const r = await fetch(url, { headers: ROBLOX_UA, signal: AbortSignal.timeout(8_000) }).catch(() => null);
    if (r?.ok) {
      info = (await r.json().catch(() => null)) as RobloxProductInfo | null;
      break;
    }
  }

  if (!info?.ProductId) throw new BuyoutError("Геймпасс не найден", 404);

  const price = info.PriceInRobux ?? 0;
  const base = info.UserBasePriceInRobux ?? price;
  let image: string | null = null;

  const tRes = await fetch(
    `https://thumbnails.roblox.com/v1/game-passes?gamePassIds=${gpId}&size=150x150&format=Png&isCircular=false`,
    { headers: ROBLOX_UA, signal: AbortSignal.timeout(5_000) },
  ).catch(() => null);
  if (tRes?.ok) {
    const tData = (await tRes.json().catch(() => null)) as RobloxThumbnailResponse | null;
    image = tData?.data?.[0]?.imageUrl ?? null;
  }

  return {
    gamepassId: Number(gpId),
    productId: info.ProductId,
    name: info.Name ?? "Gamepass",
    price,
    sellerName: info.Creator?.Name ?? "Unknown",
    sellerId: info.Creator?.Id ?? info.Creator?.CreatorTargetId ?? 0,
    isForSale: info.IsForSale ?? false,
    isManagedPricing: price !== base,
    basePriceInRobux: base,
    image,
  };
}

/**
 * Resolves the price Roblox will charge a particular cookie account.
 *
 * Managed/Regional Pricing makes `PriceInRobux` depend on the authenticated
 * buyer while `UserBasePriceInRobux` remains the seller's configured global
 * price. Purchase paths must use this resolver immediately before POSTing to
 * economy.roblox.com; public/roproxy product-info can otherwise cause a
 * deterministic `PriceChanged` refusal.
 *
 * The Roblox cookie is sent only to the official Roblox origin, never to a
 * proxy fallback.
 */
export async function resolveGamepassForBuyer(
  raw: string,
  cookie: string,
): Promise<ResolvedGamepass> {
  const gpId = parseGamepassId(raw);
  if (!gpId) throw new BuyoutError("Невалидный ID геймпасса", 400);

  const r = await fetch(
    `https://apis.roblox.com/game-passes/v1/game-passes/${gpId}/product-info`,
    {
      headers: { ...ROBLOX_UA, Cookie: `.ROBLOSECURITY=${cookie}` },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    },
  ).catch(() => null);
  if (!r?.ok) throw new BuyoutError("Не удалось получить персональную цену Roblox", 502);

  const info = (await r.json().catch(() => null)) as RobloxProductInfo | null;
  if (!info?.ProductId) throw new BuyoutError("Геймпасс не найден", 404);

  const price = info.PriceInRobux ?? 0;
  const base = info.UserBasePriceInRobux ?? price;
  return {
    gamepassId: Number(gpId),
    productId: info.ProductId,
    name: info.Name ?? "Gamepass",
    price,
    sellerName: info.Creator?.Name ?? "Unknown",
    sellerId: info.Creator?.Id ?? info.Creator?.CreatorTargetId ?? 0,
    isForSale: info.IsForSale ?? false,
    isManagedPricing: price !== base,
    basePriceInRobux: base,
    image: null,
  };
}

async function getBalance(cookie: string): Promise<number | null> {
  const bRes = await fetch("https://economy.roblox.com/v1/user/currency", {
    headers: { ...ROBLOX_UA, Cookie: `.ROBLOSECURITY=${cookie}` },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!bRes?.ok) return null;
  const bData = (await bRes.json().catch(() => null)) as RobloxBalanceResponse | null;
  return bData?.robux ?? null;
}

export async function purchaseGamepassWithCookie(
  cookie: string,
  // gamepassId — опционален: с ним провал покупки перепроверяется по inventory-API
  // (Ф1; без него ложный провал при таймауте/5xx приведёт к ложному refund).
  input: { productId: string | number; price: number; sellerId: string | number; gamepassId?: string | number },
): Promise<PurchaseResult> {
  const csrfRes = await fetch("https://auth.roblox.com/v2/logout", {
    method: "POST",
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  let csrf = csrfRes?.headers.get("x-csrf-token");
  if (!csrf) throw new BuyoutError("Не удалось получить CSRF — cookie протух?", 502);

  let purchaseRes: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    purchaseRes = await fetch(`https://economy.roblox.com/v1/purchases/products/${input.productId}`, {
      method: "POST",
      headers: {
        Cookie: `.ROBLOSECURITY=${cookie}`,
        "Content-Type": "application/json",
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({
        expectedCurrency: 1,
        expectedPrice: input.price,
        expectedSellerId: Number(input.sellerId),
      }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);

    if (purchaseRes?.status === 403) {
      const newCsrf = purchaseRes.headers.get("x-csrf-token");
      if (newCsrf && attempt === 0) {
        csrf = newCsrf;
        continue;
      }
    }
    break;
  }

  if (purchaseRes?.status === 401) {
    return { success: false, msg: "Cookie истёк — обнови", balance: null, failureKind: "internal" };
  }

  const purchaseData = (await purchaseRes?.json().catch(() => null)) as RobloxPurchaseResponse | null;
  if (!purchaseData) {
    // Ф1: «Нет ответа» не значит «не куплено» — Roblox при таймауте/5xx нередко
    // всё же проводит транзакцию. Владение подтвердилось → это успех, а не 502
    // (иначе ложный откат/refund при фактически купленном пассе).
    if (input.gamepassId) {
      const owned = await verifyOwnershipAfterFailure(cookie, input.gamepassId, false);
      if (owned === true) {
        console.warn(`[roblox-buyout] recovered: продукт ${input.productId} — владение подтверждено после «Нет ответа»`);
        return {
          success: true,
          msg: "Куплено (владение подтверждено проверкой после «Нет ответа от Roblox»)",
          price: input.price,
          balance: await getBalance(cookie),
          recovered: true,
        };
      }
    }
    throw new BuyoutError("Нет ответа от Roblox", 502);
  }

  const balance = await getBalance(cookie);
  const alreadyOwned = /already.?own/i.test(purchaseData.reason ?? "");

  if (purchaseData.purchased || alreadyOwned) {
    const price = purchaseData.price ?? input.price;
    return {
      success: true,
      msg: alreadyOwned ? "AlreadyOwned — предыдущая покупка прошла" : `Куплено за ${price} R$`,
      price,
      balance,
      alreadyOwned,
    };
  }

  const failReason = purchaseData.reason ?? purchaseData.errorMsg ?? "Неизвестная ошибка";

  // Ф1: провал с неканоничным reason тоже перепроверяем — владение = успех.
  if (input.gamepassId && needsOwnershipCheck(purchaseData.reason ?? purchaseData.errorMsg)) {
    const owned = await verifyOwnershipAfterFailure(
      cookie,
      input.gamepassId,
      Boolean(purchaseData.reason ?? purchaseData.errorMsg),
    );
    if (owned === true) {
      console.warn(`[roblox-buyout] recovered: продукт ${input.productId} — владение подтверждено после ошибки «${failReason}»`);
      return {
        success: true,
        msg: `Куплено (владение подтверждено проверкой после ошибки: ${failReason})`,
        price: input.price,
        balance: await getBalance(cookie),
        recovered: true,
      };
    }
  }

  return {
    success: false,
    msg: failReason,
    balance,
    failureKind: classifyPurchaseFailure(purchaseData.reason ?? purchaseData.errorMsg ?? ""),
  };
}

function classifyPurchaseFailure(reason: string): PurchaseFailureKind {
  if (/insufficient.?funds/i.test(reason)) return "internal";
  if (/price.?changed|not.?for.?sale|invalid.?product|seller/i.test(reason)) return "row";
  return "unknown";
}

// ── Контрольная проверка владения после ошибки выкупа (Ф1) ──────────────────
//
// Roblox при таймауте/5xx нередко всё же проводит транзакцию, а клиентский код
// видит провал. Любой провал, кроме «чистых отказов без списания», перепроверяем
// по inventory-API: владение = покупка на самом деле прошла (recovered-успех).
// Зеркало: bots/shared/roblox.ts (bots/ и src/ не импортируют друг друга) —
// менять синхронно.

/** Отказы, при которых Roblox гарантированно НЕ провёл транзакцию. */
const CLEAN_REFUSAL_RE = /insufficient.?funds|not.?for.?sale|price.?changed|cookie/i;

/**
 * Нужна ли контрольная проверка владения после провала покупки.
 * reason отсутствует у сетевых ошибок/таймаутов/нераспарсенных ответов —
 * там проверка нужна обязательно.
 */
export function needsOwnershipCheck(reason: string | null | undefined): boolean {
  return !(reason && CLEAN_REFUSAL_RE.test(reason));
}

/**
 * Владеет ли аккаунт cookie геймпассом. true/false — достоверный ответ,
 * null — проверка недоступна (сеть/авторизация), трактовать консервативно.
 */
export async function verifyGamepassOwnership(
  cookie: string,
  gamepassId: string | number,
): Promise<boolean | null> {
  const uRes = await fetch("https://users.roblox.com/v1/users/authenticated", {
    headers: { ...ROBLOX_UA, Cookie: `.ROBLOSECURITY=${cookie}` },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!uRes?.ok) return null;
  const user = (await uRes.json().catch(() => null)) as { id?: number } | null;
  if (!user?.id) return null;

  const res = await fetch(
    `https://inventory.roblox.com/v1/users/${user.id}/items/GamePass/${gamepassId}`,
    { headers: ROBLOX_UA, signal: AbortSignal.timeout(8_000) },
  ).catch(() => null);
  if (!res?.ok) return null;
  const json = (await res.json().catch(() => null)) as { data?: unknown[] } | null;
  return Array.isArray(json?.data) ? json.data.length > 0 : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Контрольная проверка владения после провала покупки: пауза ~2.5 с (Roblox
 * проводит транзакцию с задержкой) → проверка; при провале без каноничного
 * reason (таймаут/«Нет ответа») или недоступной проверке — повтор через ~5 с.
 */
export async function verifyOwnershipAfterFailure(
  cookie: string,
  gamepassId: string | number,
  hasCanonicalReason: boolean,
): Promise<boolean | null> {
  await sleep(2_500);
  let owned = await verifyGamepassOwnership(cookie, gamepassId);
  if (owned !== true && (owned === null || !hasCanonicalReason)) {
    await sleep(5_000);
    owned = await verifyGamepassOwnership(cookie, gamepassId);
  }
  return owned;
}
