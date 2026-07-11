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
  input: { productId: string | number; price: number; sellerId: string | number },
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
  if (!purchaseData) throw new BuyoutError("Нет ответа от Roblox", 502);

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

  return {
    success: false,
    msg: purchaseData.reason ?? purchaseData.errorMsg ?? "Неизвестная ошибка",
    balance,
    failureKind: classifyPurchaseFailure(purchaseData.reason ?? purchaseData.errorMsg ?? ""),
  };
}

function classifyPurchaseFailure(reason: string): PurchaseFailureKind {
  if (/insufficient.?funds/i.test(reason)) return "internal";
  if (/price.?changed|not.?for.?sale|invalid.?product|seller/i.test(reason)) return "row";
  return "unknown";
}
