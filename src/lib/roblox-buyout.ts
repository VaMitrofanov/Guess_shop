import { classifyBuyerPrice, type RobloxPriceDiscountDetail } from "@/lib/purchase-guard";
import {
  browserFailureMessage,
  getBrowserGamepassPreflight,
  getBrowserSession,
  isBrowserInfrastructureFailure,
  purchaseGamepassInBrowser,
} from "@/lib/browser-purchase";

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
  priceDiscountDetails: RobloxPriceDiscountDetail[];
  robloxPlusDiscountPercent: number | null;
  hasUnsafeBuyerPrice: boolean;
  image: string | null;
  /** Present only for buyer-specific resolution through the SG browser. */
  buyerAccountId?: number;
  buyerAccountName?: string;
  buyerBalance?: number;
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
  reason?: string;
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
  PriceDiscountDetails?: RobloxPriceDiscountDetail[];
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
  const priceDiscountDetails = Array.isArray(info.PriceDiscountDetails) ? info.PriceDiscountDetails : [];
  const buyerPrice = classifyBuyerPrice(price, base, priceDiscountDetails);
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
    priceDiscountDetails,
    robloxPlusDiscountPercent: buyerPrice.kind === "ROBLOX_PLUS" ? buyerPrice.discountPercent : null,
    hasUnsafeBuyerPrice: buyerPrice.kind === "UNSAFE_DISCOUNT",
    image,
  };
}

/**
 * Resolves the price Roblox will charge a particular cookie account.
 *
 * Managed/Regional Pricing makes `PriceInRobux` depend on the authenticated
 * buyer while `UserBasePriceInRobux` remains the seller's configured global
 * price. Purchase paths use this resolver immediately before the browser
 * purchase. The cookie is sent only to the SG browser service; authenticated
 * Roblox calls and donor identity are resolved in that same persistent Chrome.
 */
export async function resolveGamepassForBuyer(
  raw: string,
  cookie: string,
): Promise<ResolvedGamepass> {
  const gpId = parseGamepassId(raw);
  if (!gpId) throw new BuyoutError("Невалидный ID геймпасса", 400);
  const result = await getBrowserGamepassPreflight(cookie, gpId);
  if (!result.ok || !result.gamepass) {
    const status = result.code === "DONOR_COOKIE_INVALID" ? 401 : 502;
    throw new BuyoutError(browserFailureMessage(result.reason, result.code), status);
  }
  const info = result.gamepass;
  const price = info.price;
  const base = info.basePriceInRobux;
  const priceDiscountDetails = info.priceDiscountDetails;
  const buyerPrice = classifyBuyerPrice(price, base, priceDiscountDetails);
  return {
    gamepassId: Number(gpId),
    productId: info.productId,
    name: info.name,
    price,
    sellerName: info.sellerName,
    sellerId: info.sellerId,
    isForSale: info.isForSale,
    isManagedPricing: price !== base,
    basePriceInRobux: base,
    priceDiscountDetails,
    robloxPlusDiscountPercent: buyerPrice.kind === "ROBLOX_PLUS" ? buyerPrice.discountPercent : null,
    hasUnsafeBuyerPrice: buyerPrice.kind === "UNSAFE_DISCOUNT",
    image: null,
    buyerAccountId: result.session?.accountId,
    buyerAccountName: result.session?.accountName,
    buyerBalance: result.session?.balance,
  };
}

export async function purchaseGamepassWithCookie(
  cookie: string,
  // gamepassId — опционален: с ним провал покупки перепроверяется по inventory-API
  // (Ф1; без него ложный провал при таймауте/5xx приведёт к ложному refund).
  input: { productId: string | number; price: number; sellerId: string | number; gamepassId?: string | number },
): Promise<PurchaseResult> {
  if (!input.gamepassId) {
    return {
      success: false,
      msg: "BrowserUnavailable: browser transport требует gamepassId",
      reason: "BrowserUnavailable",
      balance: null,
      failureKind: "internal",
    };
  }

  const browserSession = await getBrowserSession(cookie);
  const buyerUserId = browserSession.session?.accountId ?? null;
  if (!browserSession.ok || !buyerUserId) {
    const reason = `${browserSession.code}: ${browserSession.reason ?? "browser session недоступна"}`;
    return {
      success: false,
      msg: browserFailureMessage(browserSession.reason, browserSession.code),
      reason,
      balance: null,
      failureKind: "internal",
    };
  }

  const result = await purchaseGamepassInBrowser({
    cookie,
    gamepassId: input.gamepassId,
    productId: input.productId,
    expectedPrice: input.price,
    sellerId: input.sellerId,
    buyerUserId,
  });
  if (result.purchased) {
    const price = result.price ?? input.price;
    return {
      success: true,
      msg: `Куплено браузером за ${price} R$`,
      reason: result.reason,
      price,
      balance: result.balanceAfter ?? null,
    };
  }

  const failureReason = result.code ? `${result.code}: ${result.reason}` : result.reason;
  return {
    success: false,
    msg: browserFailureMessage(result.reason, result.code),
    reason: failureReason,
    balance: result.balanceAfter ?? result.balanceBefore ?? null,
    failureKind: isBrowserInfrastructureFailure(failureReason)
      ? "internal"
      : /GuardStop|ScriptRefused|AlreadyOwned|NotConfirmed|BuyButtonMissing|PRICE_GUARD|SELLER_GUARD|OWNERSHIP_GUARD|NOT_FOR_SALE/i.test(failureReason)
        ? "row"
        : "unknown",
  };
}

/**
 * Roblox retired `economy/v1/purchases/products` on 2026-04-10. Its current
 * response is the old-shaped `InvalidArguments`/`Invalid arguments.` error.
 * This is a transport outage on our side, not a bad partner row/gamepass.
 */
export function isLegacyPurchaseFlowFailure(reason: string | null | undefined): boolean {
  return /invalid.?arguments|invalid.?parameter/i.test(String(reason ?? ""));
}

export function classifyPurchaseFailure(reason: string): PurchaseFailureKind {
  if (/insufficient.?funds/i.test(reason) || isLegacyPurchaseFlowFailure(reason)) return "internal";
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
const CLEAN_REFUSAL_RE = /insufficient.?funds|not.?for.?sale|price.?changed|cookie|invalid.?arguments|invalid.?parameter|BrowserUnavailable|NotLoggedIn|WrongAccount|TwoStepRequired|CookieInjectionFailed|QueueFull|DriverError|BalanceMismatch|BalanceUnconfirmed|GuardStop|ScriptRefused|AlreadyOwned|NotConfirmed|BuyButtonMissing/i;

/**
 * Нужна ли контрольная проверка владения после провала покупки.
 * reason отсутствует у сетевых ошибок/таймаутов/нераспарсенных ответов —
 * там проверка нужна обязательно.
 */
export function needsOwnershipCheck(reason: string | null | undefined): boolean {
  return !(reason && CLEAN_REFUSAL_RE.test(reason));
}

/**
 * userId аккаунта, которому принадлежит cookie. null — определить не удалось.
 */
export async function getAuthenticatedUserId(cookie: string): Promise<number | null> {
  const result = await getBrowserSession(cookie);
  return result.ok ? result.session?.accountId ?? null : null;
}

/**
 * Владеет ли аккаунт cookie геймпассом. true/false — достоверный ответ,
 * null — проверка недоступна (сеть/авторизация), трактовать консервативно.
 */
export async function verifyGamepassOwnership(
  cookie: string,
  gamepassId: string | number,
): Promise<boolean | null> {
  const result = await getBrowserGamepassPreflight(cookie, gamepassId);
  return result.ok ? result.gamepass?.owned ?? null : null;
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
