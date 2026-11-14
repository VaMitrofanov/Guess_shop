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
 *
 * v2 (14.11.2026): owner price list for the live site sale. The base price is
 * what a guest pays; a registered customer pays it minus their PERSONAL discount
 * (1 % on sign-up, up to 5 % for invited buyers — `CODE_DISCOUNT_TIERS`). On
 * 2500/4500/10000 the maximum discount is already priced in: 5 % off the base
 * lands near the former 2849/4949/9999 ₽.
 *
 * Rounding (owner, 14.11.2026): kopecks look cheap, so the discounted sum is a
 * whole ruble — rounded UP, unless the ruble part already ends in 9 (rounding up
 * would carry into the next digit and spoil the "…9" look): 3 999,03 → 3 999,
 * 3 542,04 → 3 543. See `roundCodePriceKopecks`.
 */

export const CODES_PRICING_POLICY_VERSION = "retail-codes-v2";

/** Owner-approved 2026-11-14. Denomination in R$ -> base price in whole ₽. */
export const CODE_PRICES: Readonly<Record<number, number>> = Object.freeze({
  100: 239,
  200: 349,
  800: 999,
  1000: 1199,
  2000: 2399,
  2500: 2999,
  4500: 5219,
  10000: 10529,
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
 * Base price in whole rubles for a supported denomination.
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

// ─── Personal discount ladder ─────────────────────────────────────────────────

/**
 * Tiers REPLACE each other, they never add up. `invited` = invited people who
 * registered by the link and completed their first paid, delivered order.
 */
export const CODE_DISCOUNT_TIERS: readonly { readonly invited: number; readonly percent: number }[] = Object.freeze([
  { invited: 0, percent: 1 },
  { invited: 3, percent: 2 },
  { invited: 10, percent: 3 },
  { invited: 20, percent: 4 },
  { invited: 30, percent: 5 },
]);

export const CODE_MAX_DISCOUNT_PERCENT = 5;
export const CODE_SIGNUP_DISCOUNT_PERCENT = 1;

/** Discount a customer has right now. A guest (no account) always has 0 %. */
export function codeDiscountPercent(input: { registered: boolean; invitedCount: number }): number {
  if (!input.registered) return 0;
  const invited = Number.isFinite(input.invitedCount) ? Math.max(0, Math.floor(input.invitedCount)) : 0;
  let percent = 0;
  for (const tier of CODE_DISCOUNT_TIERS) if (invited >= tier.invited) percent = tier.percent;
  return percent;
}

export interface CodeDiscountProgress {
  percent: number;
  invitedCount: number;
  /** Next tier, or null at the maximum. */
  next: { percent: number; invited: number; remaining: number } | null;
  /** 0..1 progress from the current tier threshold to the next one. */
  progress: number;
}

export function codeDiscountProgress(invitedCount: number): CodeDiscountProgress {
  const invited = Math.max(0, Math.floor(invitedCount || 0));
  const percent = codeDiscountPercent({ registered: true, invitedCount: invited });
  const currentIndex = CODE_DISCOUNT_TIERS.findIndex((tier) => tier.percent === percent);
  const current = CODE_DISCOUNT_TIERS[currentIndex];
  const nextTier = CODE_DISCOUNT_TIERS[currentIndex + 1];
  if (!nextTier) return { percent, invitedCount: invited, next: null, progress: 1 };
  const span = nextTier.invited - current.invited;
  return {
    percent,
    invitedCount: invited,
    next: { percent: nextTier.percent, invited: nextTier.invited, remaining: nextTier.invited - invited },
    progress: Math.min(1, Math.max(0, (invited - current.invited) / span)),
  };
}

/**
 * Whole-ruble price after a discount: up to the next ruble, except when the
 * ruble part ends in 9 — then the kopecks are dropped (3 999,03 → 3 999).
 */
export function roundCodePriceKopecks(kopecks: number): number {
  if (!Number.isSafeInteger(kopecks) || kopecks < 0) throw new RangeError(`Bad kopecks: ${kopecks}`);
  if (kopecks % 100 === 0) return kopecks;
  const rubles = Math.floor(kopecks / 100);
  return (rubles % 10 === 9 ? rubles : rubles + 1) * 100;
}

export interface CodeQuote {
  denomination: number;
  policyVersion: typeof CODES_PRICING_POLICY_VERSION;
  baseAmountKopecks: number;
  discountPercent: number;
  discountKopecks: number;
  finalAmountKopecks: number;
}

/**
 * The one place a code's payable sum is computed. Integer kopecks, always a
 * whole ruble (`roundCodePriceKopecks`); `discountKopecks` is the real
 * difference between base and payable sum after rounding.
 */
export function quoteCode(denomination: number, discountPercent: number): CodeQuote {
  if (!isCodeDenomination(denomination)) throw new RangeError(`Unsupported code denomination: ${denomination}`);
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > CODE_MAX_DISCOUNT_PERCENT) {
    throw new RangeError(`Unsupported code discount: ${discountPercent}`);
  }
  const baseAmountKopecks = CODE_PRICES[denomination] * 100;
  const exact = baseAmountKopecks - Math.round((baseAmountKopecks * discountPercent) / 100);
  const finalAmountKopecks = roundCodePriceKopecks(exact);
  return {
    denomination,
    policyVersion: CODES_PRICING_POLICY_VERSION,
    baseAmountKopecks,
    discountPercent,
    discountKopecks: baseAmountKopecks - finalAmountKopecks,
    finalAmountKopecks,
  };
}

/** «1 139,05 ₽» / «999 ₽» — kopecks shown only when there are any. */
export function formatRubKopecks(kopecks: number): string {
  const whole = kopecks % 100 === 0;
  return `${(kopecks / 100).toLocaleString("ru-RU", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })} ₽`;
}
