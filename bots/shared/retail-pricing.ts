/**
 * Canonical retail price policy shared by Telegram, VK and the web storefront.
 *
 * The owner defines a decreasing target amount that RobloxBank must retain per
 * paid R$ after the conservative ordinary-payment deductions. The customer
 * price is grossed up for:
 *   - USN "income": 6% of the full customer payment;
 *   - acquiring: max(3.49 RUB, 3.49% of the customer payment).
 *
 * "Dolями" and an unconfirmed separate fiscal-service fee are intentionally
 * outside this policy. Customer prices round up to whole rubles so the retained
 * amount can never fall below the target because of display/payment rounding.
 */

export const RETAIL_PRICING_POLICY_VERSION = "retail-direct-v2";

export const USN_INCOME_RATE = 0.06;
export const ACQUIRING_RATE = 0.0349;
export const ACQUIRING_MIN_RUB = 3.49;

export const CUSTOM_MIN = 100;
export const CUSTOM_MAX = 100_000;
/** Minimum pack that can receive an active R$ bonus (zero = every pack). */
export const BONUS_MIN_PACK = 0;

/** Stable quick-pick denominations shown by TG/VK and the site. */
export const DIRECT_PACKS: readonly number[] = [100, 200, 300, 400, 500, 800, 1000, 1200, 1500, 2000];

/** Desired RUB retained per paid R$ before Robux cost, after payment deductions. */
export function targetNetRate(amount: number): number {
  if (!Number.isFinite(amount) || amount < 1) return 0;

  if (amount <= 10) return 3 - ((3 - 2) / (10 - 1)) * (amount - 1);
  if (amount <= 50) return 2 - ((2 - 1.6) / (50 - 10)) * (amount - 10);
  if (amount <= 100) return 1.6 - ((1.6 - 1.3) / (100 - 50)) * (amount - 50);
  if (amount <= 500) return 1.3 - ((1.3 - 1) / (500 - 100)) * (amount - 100);
  if (amount <= 1000) return 1 - ((1 - 0.9) / (1000 - 500)) * (amount - 500);
  if (amount <= 3000) return 0.9 - ((0.9 - 0.8) / (3000 - 1000)) * (amount - 1000);
  if (amount <= 5000) return 0.8 - ((0.8 - 0.7) / (5000 - 3000)) * (amount - 3000);
  return 0.7;
}

/** Amount retained after USN and the conservative ordinary acquiring fee. */
export function retainedAfterPaymentCosts(customerPriceRub: number): number {
  if (!Number.isFinite(customerPriceRub) || customerPriceRub <= 0) return 0;
  const acquiring = Math.max(ACQUIRING_MIN_RUB, customerPriceRub * ACQUIRING_RATE);
  return customerPriceRub * (1 - USN_INCOME_RATE) - acquiring;
}

/** Exact, unrounded customer payment needed to retain `targetNetRub`. */
export function customerPriceForTargetNet(targetNetRub: number): number {
  if (!Number.isFinite(targetNetRub) || targetNetRub <= 0) return 0;

  const fixedCommissionPrice =
    (targetNetRub + ACQUIRING_MIN_RUB) / (1 - USN_INCOME_RATE);
  const percentageCommissionPrice =
    targetNetRub / (1 - USN_INCOME_RATE - ACQUIRING_RATE);

  // At 100 RUB both acquiring expressions equal 3.49 RUB. Below it the
  // minimum applies; from 100 RUB the 3.49% expression applies.
  return fixedCommissionPrice <= 100
    ? fixedCommissionPrice
    : percentageCommissionPrice;
}

/**
 * Returns the buyer-facing price in whole rubles for a whole-number R$ amount.
 * API handlers enforce CUSTOM_MIN/CUSTOM_MAX; invalid previews safely return 0.
 */
export function directPrice(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const normalized = Math.round(amount);
  const targetNetRub = normalized * targetNetRate(normalized);
  return Math.ceil(customerPriceForTargetNet(targetNetRub));
}

/** Published pack prices are derived from the same curve, never overridden. */
export const DIRECT_PRICES: Readonly<Record<number, number>> = Object.freeze(
  Object.fromEntries(DIRECT_PACKS.map((amount) => [amount, directPrice(amount)])),
);

/** Buyer-facing RUB/R$ rate, including USN and acquiring gross-up. */
export function customRate(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const normalized = Math.round(amount);
  return Number((directPrice(normalized) / normalized).toFixed(4));
}

export interface RetailPriceBreakdown {
  amountRobux: number;
  rubles: number;
  /** What the buyer pays per received paid R$. */
  rubPerRobux: number;
  /** Internal target retained per paid R$ after USN and acquiring. */
  targetNetRate: number;
  targetNetRubles: number;
  paymentOverheadRubles: number;
  /** @deprecated v2 has no arbitrary small-order surcharge. */
  smallOrderSurcharge: 0;
  policyVersion: typeof RETAIL_PRICING_POLICY_VERSION;
}

export function getRetailPriceBreakdown(amount: number): RetailPriceBreakdown {
  const normalized = Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
  const rubles = directPrice(normalized);
  const netRate = targetNetRate(normalized);
  const targetNetRubles = normalized * netRate;

  return {
    amountRobux: normalized,
    rubles,
    rubPerRobux: normalized > 0 ? customRate(normalized) : 0,
    targetNetRate: Number(netRate.toFixed(4)),
    targetNetRubles: Number(targetNetRubles.toFixed(2)),
    paymentOverheadRubles: Number(Math.max(0, rubles - targetNetRubles).toFixed(2)),
    smallOrderSurcharge: 0,
    policyVersion: RETAIL_PRICING_POLICY_VERSION,
  };
}
