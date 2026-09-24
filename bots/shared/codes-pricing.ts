/**
 * Canonical price policy for Roblox activation codes, shared by Telegram, VK
 * and the web storefront.
 *
 * Deliberately separate from `retail-pricing.ts`: codes are a different product
 * (an instant bearer instrument, not a gamepass buyout service) sold at a
 * different price. Merging the two tables would eventually sell a code at the
 * gamepass price. Same mechanics, two policies.
 *
 * Unlike the gamepass policy there is no `customRate`: a code only exists in the
 * denominations a supplier actually sells, so an arbitrary amount is not a
 * product we can deliver.
 */

export const CODES_PRICING_POLICY_VERSION = "retail-codes-v1";

/** Owner-approved 2026-07-17. Denomination in R$ -> price in ₽. */
export const CODE_PRICES: Readonly<Record<number, number>> = Object.freeze({
  100: 309,
  200: 309,
  800: 999,
  1000: 1199,
  2000: 2299,
  4500: 4899,
  10000: 9899,
});

export const CODE_DENOMINATIONS: readonly number[] = Object.freeze(
  Object.keys(CODE_PRICES)
    .map(Number)
    .sort((a, b) => a - b),
);

export interface CodePriceBreakdown {
  amountRobux: number;
  rubles: number;
  rubPerRobux: number;
  policyVersion: typeof CODES_PRICING_POLICY_VERSION;
}

export function isCodeDenomination(amount: number): boolean {
  return Number.isInteger(amount) && CODE_PRICES[amount] !== undefined;
}

/**
 * Price in whole rubles for a supported denomination.
 *
 * Returns 0 for anything else — including amounts the gamepass flow accepts —
 * so a UI preview stays safe. Callers that take money must gate on
 * `isCodeDenomination` first rather than treating 0 as free.
 */
export function codePrice(amount: number): number {
  if (!isCodeDenomination(amount)) return 0;
  return CODE_PRICES[amount];
}

export function getCodePriceBreakdown(amount: number): CodePriceBreakdown {
  const supported = isCodeDenomination(amount);
  const rubles = supported ? CODE_PRICES[amount] : 0;
  return {
    amountRobux: supported ? amount : 0,
    rubles,
    rubPerRobux: supported ? rubles / amount : 0,
    policyVersion: CODES_PRICING_POLICY_VERSION,
  };
}
