/**
 * Canonical retail price policy shared by Telegram, VK and the web storefront.
 *
 * This module intentionally has no database or transport dependencies: all
 * three runtimes import the exact same deterministic calculation. A future
 * database policy/quote can select a version, but must never reimplement the
 * tier boundaries in a controller or UI component.
 */

export const RETAIL_PRICING_POLICY_VERSION = "retail-direct-v1";

/** Available packs shown by TG/VK and the site, in ₽. */
export const DIRECT_PRICES: Readonly<Record<number, number>> = {
  100: 160,
  200: 260,
  300: 360,
  400: 460,
  500: 450,
  800: 720,
  1000: 800,
  1200: 960,
  1500: 1050,
  2000: 1400,
};

export const DIRECT_PACKS = Object.keys(DIRECT_PRICES).map(Number) as number[];
export const CUSTOM_MIN = 100;
export const CUSTOM_MAX = 100_000;
/** Minimum pack that can receive an active R$ bonus (zero = every pack). */
export const BONUS_MIN_PACK = 0;

export interface RetailPriceBreakdown {
  amountRobux: number;
  rubles: number;
  rubPerRobux: number;
  smallOrderSurcharge: number;
  policyVersion: typeof RETAIL_PRICING_POLICY_VERSION;
}

/** Rate per R$ for custom amounts. Exact tier boundaries are contractual. */
export function customRate(amount: number): number {
  if (amount < 500) return 1;
  if (amount < 1000) return 0.9;
  if (amount < 1500) return 0.8;
  return 0.7;
}

/**
 * Returns the price in whole rubles for a whole-number R$ amount.
 * Invalid/non-positive values intentionally produce zero for safe UI previews;
 * API handlers enforce the min/max business limits separately.
 */
export function directPrice(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const normalized = Math.round(amount);
  const packPrice = DIRECT_PRICES[normalized];
  if (packPrice !== undefined) return packPrice;

  const surcharge = normalized < 500 ? 60 : 0;
  return Math.round(customRate(normalized) * normalized + surcharge);
}

export function getRetailPriceBreakdown(amount: number): RetailPriceBreakdown {
  const normalized = Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
  return {
    amountRobux: normalized,
    rubles: directPrice(normalized),
    rubPerRobux: normalized > 0 ? customRate(normalized) : 0,
    smallOrderSurcharge: normalized > 0 && normalized < 500 ? 60 : 0,
    policyVersion: RETAIL_PRICING_POLICY_VERSION,
  };
}
