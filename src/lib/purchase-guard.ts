/**
 * Прайс-гард выкупа (PLAN-gp-price-guard, инцидент 2026-07-12): геймпасс
 * покупается ТОЛЬКО по цене, совпадающей с ожидаемой по номиналу заказа.
 * Клиент, поднявший цену пасса после приёма ботом, раньше получал выкуп по
 * live-цене без сверки (TOCTOU) — заказ на 500 закрылся покупкой за 1143.
 *
 * Формула и допуск — эталон автовыкупа (bots/tg/auto-workers.ts):
 * expected = ceil(amount / 0.7), допуск ±PRICE_TOL. Для DIR-заказов amount
 * уже включает бонус (totalAmount), для WB/Avito amount = номинал.
 */
export const PRICE_TOL = 2;
export const BUYOUT_ERROR_REGIONAL_PRICE = "REGIONAL_PRICE";

export type RobloxPriceDiscountDetail = {
  Type?: string;
  AmountInRobux?: number;
  Percent?: number;
  EndTime?: string | null;
};

export type BuyerPriceClassification = {
  kind: "FULL_PRICE" | "ROBLOX_PLUS" | "UNSAFE_DISCOUNT";
  discountPercent: number | null;
  discountAmount: number;
};

/**
 * Roblox Plus is the only buyer-specific discount currently accepted by the
 * buyout system. Roblox identifies it explicitly in PriceDiscountDetails and
 * subsidises the discount, so the seller payout still follows basePrice.
 * Unknown, mixed or arithmetically inconsistent discounts stay fail-closed.
 */
export function classifyBuyerPrice(
  livePrice: number,
  userBasePrice?: number | null,
  discountDetails?: RobloxPriceDiscountDetail[] | null,
): BuyerPriceClassification {
  const base = Number(userBasePrice);
  if (!Number.isFinite(livePrice) || !Number.isFinite(base) || base <= 0) {
    return { kind: "FULL_PRICE", discountPercent: null, discountAmount: 0 };
  }
  if (livePrice === base) {
    return { kind: "FULL_PRICE", discountPercent: null, discountAmount: 0 };
  }

  const details = Array.isArray(discountDetails) ? discountDetails : [];
  if (details.length !== 1) {
    return { kind: "UNSAFE_DISCOUNT", discountPercent: null, discountAmount: Math.max(0, base - livePrice) };
  }
  const detail = details[0];
  const percent = Number(detail.Percent);
  const amount = Number(detail.AmountInRobux);
  const expectedAmount = Math.floor(base * percent / 100);
  const plusIsValid = detail.Type === "RobloxPlusSubscription"
    && (percent === 10 || percent === 20)
    && Number.isInteger(amount)
    && amount > 0
    && amount === expectedAmount
    && livePrice === base - amount;
  return plusIsValid
    ? { kind: "ROBLOX_PLUS", discountPercent: percent, discountAmount: amount }
    : { kind: "UNSAFE_DISCOUNT", discountPercent: null, discountAmount: Math.max(0, base - livePrice) };
}

export const expectedGamepassPrice = (amount: number): number => Math.ceil(amount / 0.7);

/** Unknown/Regional buyer pricing is active. Typed Roblox Plus is safe. */
export function hasRegionalPrice(
  livePrice: number,
  userBasePrice?: number | null,
  discountDetails?: RobloxPriceDiscountDetail[] | null,
): boolean {
  return classifyBuyerPrice(livePrice, userBasePrice, discountDetails).kind === "UNSAFE_DISCOUNT";
}

export function checkGamepassPrice(
  amount: number,
  livePrice: number,
  userBasePrice?: number | null,
): { ok: boolean; expected: number } {
  const expected = expectedGamepassPrice(amount);
  // Base price validates the seller's nominal. Buyer price is used for the
  // actual debit only after classifyBuyerPrice() has accepted typed Plus.
  const validationPrice = Number.isFinite(userBasePrice) && Number(userBasePrice) > 0
    ? Number(userBasePrice)
    : livePrice;
  return { ok: Math.abs(validationPrice - expected) <= PRICE_TOL, expected };
}

/**
 * Продавец пасса должен совпадать с подтверждённым ником заказа
 * (case-insensitive, как seller-check автовыкупа). Нет данных — не блокируем.
 */
export function sellerMatchesOrder(
  orderNick: string | null | undefined,
  creatorName: string | null | undefined,
): boolean {
  if (!orderNick || !creatorName) return true;
  return orderNick.toLowerCase() === creatorName.toLowerCase();
}
