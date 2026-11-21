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
 * v3 (20.11.2026, owner): twelve packs, and the price FOLLOWS THE DOLLAR. The
 * owner's list is computed at 85 ₽/$ (`CODES_REFERENCE_USD_RUB`); the supplier
 * is paid in dollars, bank fee and tax are a percentage of the price, so a
 * price scaled by `rate / 85` keeps every pack's margin in percent exactly as
 * in the owner's table. The rate is the admin setting «USD → RUB»
 * (`GlobalSettings.usdToRub`), set by hand — the owner chose that over the
 * central bank rate. Rounding (owner): small packs move smoothly to the whole
 * ruble, packs from 1 000 R$ snap to the nearest price ending in 9.
 *
 * Product vs supplier code (`CODE_COMPONENTS`):
 *   - «199 R$» is the supplier's 200 R$ code: a Russian account receives 199
 *     after Roblox's regional conversion, so we sell what actually arrives;
 *   - «2 000 R$» is two 1 000 R$ codes (owner: cheaper than a 2 000 code).
 * Stock (`ActivationCode.denomination`) always holds SUPPLIER denominations.
 *
 * Personal discount on top: 1 % on sign-up, up to 5 % for invited buyers
 * (`CODE_DISCOUNT_TIERS`). Rounding of the discounted sum (owner, 14.11.2026):
 * kopecks look cheap, so it is a whole ruble — rounded UP, unless the ruble
 * part already ends in 9: 3 999,03 → 3 999, 3 542,04 → 3 543.
 */

export const CODES_PRICING_POLICY_VERSION = "retail-codes-v3";
/** Orders created before 20.11.2026: one code of `denomination` R$ each. */
export const CODES_LEGACY_POLICY_VERSION = "retail-codes-v2";

/** The rate the owner's price list is computed at. */
export const CODES_REFERENCE_USD_RUB = 85;
/** A rate outside this band is a typo («8.5», «850»), not the market: fall back to the reference. */
export const CODES_USD_RUB_MIN = 60;
export const CODES_USD_RUB_MAX = 150;
/** From this pack up the price ends in 9; below it moves to the whole ruble. */
export const CODES_SNAP_TO_NINE_FROM = 1000;

/** Owner-approved 2026-11-20 at 85 ₽/$. Pack in R$ -> base price in whole ₽. */
export const CODE_PRICES: Readonly<Record<number, number>> = Object.freeze({
  10: 59,
  50: 189,
  100: 229,
  199: 359,
  500: 659,
  800: 999,
  1000: 1199,
  2000: 2349,
  2500: 2999,
  4500: 5299,
  5250: 5999,
  10000: 10499,
});

export const CODE_DENOMINATIONS: readonly number[] = Object.freeze(
  Object.keys(CODE_PRICES)
    .map(Number)
    .sort((a, b) => a - b),
);

/** Packs that are not one supplier code of the same face value. */
export const CODE_COMPONENTS: Readonly<Record<number, readonly number[]>> = Object.freeze({
  199: Object.freeze([200]),
  2000: Object.freeze([1000, 1000]),
});

/**
 * Supplier codes an order consists of. Orders priced by the v2 policy were
 * sold as one code of their own face value (a «2 000» then was one code).
 */
export function codeComponents(denomination: number, pricingVersion?: string | null): number[] {
  if (pricingVersion === CODES_LEGACY_POLICY_VERSION) return [denomination];
  return [...(CODE_COMPONENTS[denomination] ?? [denomination])];
}

/** Supplier denominations the stock may hold (import, manual issue). */
export const CODE_SUPPLIER_DENOMINATIONS: readonly number[] = Object.freeze(
  [...new Set(CODE_DENOMINATIONS.flatMap((denomination) => codeComponents(denomination)))].sort((a, b) => a - b),
);

export function isSupplierCodeDenomination(amount: number): boolean {
  return CODE_SUPPLIER_DENOMINATIONS.includes(amount);
}

/** How many packs the stock can serve: each component taken with multiplicity. */
export function packsAvailable(denomination: number, stock: ReadonlyMap<number, number>): number {
  const need = new Map<number, number>();
  for (const part of codeComponents(denomination)) need.set(part, (need.get(part) ?? 0) + 1);
  let packs = Infinity;
  for (const [part, count] of need) packs = Math.min(packs, Math.floor((stock.get(part) ?? 0) / count));
  return Number.isFinite(packs) ? packs : 0;
}

/**
 * A word under the e-mail field (and on the bot's order card) for packs that
 * are not «one code of that face value»: why 199 and not 200, and that 2 000
 * arrives as two codes.
 */
export const CODE_REGION_NOTES: Readonly<Record<number, string>> = Object.freeze({
  199: "Из-за региональных особенностей каждой страны аккаунты РФ получат 199 Robux после конвертации.",
  2000: "Придут 2 кода по 1 000 Robux — введите оба по очереди на roblox.com/redeem.",
});

export interface CodePriceBreakdown {
  amountRobux: number;
  rubles: number;
  rubPerRobux: number;
  policyVersion: typeof CODES_PRICING_POLICY_VERSION;
}

export function isCodeDenomination(amount: number): boolean {
  return Number.isInteger(amount) && CODE_PRICES[amount] !== undefined;
}

/** The admin rate, or the reference when it is missing or obviously mistyped. */
export function sanitizeCodesUsdRub(value: unknown): number {
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= CODES_USD_RUB_MIN && rate <= CODES_USD_RUB_MAX ? rate : CODES_REFERENCE_USD_RUB;
}

function nearestNine(rubles: number): number {
  return Math.max(9, Math.round((rubles - 9) / 10) * 10 + 9);
}

/**
 * Base price in whole rubles at a dollar rate (default: the reference 85 ₽/$,
 * where it equals the owner's list exactly).
 *
 * Returns 0 for anything else — including amounts the gamepass flow accepts —
 * so a UI preview stays safe. Callers that take money must gate on
 * `isCodeDenomination` first rather than treating 0 as free.
 */
export function codePrice(amount: number, usdRub: number = CODES_REFERENCE_USD_RUB): number {
  if (!isCodeDenomination(amount)) return 0;
  const reference = CODE_PRICES[amount];
  const rate = sanitizeCodesUsdRub(usdRub);
  if (rate === CODES_REFERENCE_USD_RUB) return reference;
  const scaled = (reference * rate) / CODES_REFERENCE_USD_RUB;
  return amount >= CODES_SNAP_TO_NINE_FROM ? nearestNine(scaled) : Math.max(1, Math.round(scaled));
}

/** Every pack's base price at a rate — what the storefront renders. */
export function codePriceTable(usdRub: number = CODES_REFERENCE_USD_RUB): Record<number, number> {
  return Object.fromEntries(CODE_DENOMINATIONS.map((denomination) => [denomination, codePrice(denomination, usdRub)]));
}

export function getCodePriceBreakdown(amount: number, usdRub: number = CODES_REFERENCE_USD_RUB): CodePriceBreakdown {
  const supported = isCodeDenomination(amount);
  const rubles = supported ? codePrice(amount, usdRub) : 0;
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
  /** The dollar rate the base price was computed at (after sanity bounds). */
  usdRub: number;
}

/**
 * The one place a code's payable sum is computed. Integer kopecks, always a
 * whole ruble (`roundCodePriceKopecks`); `discountKopecks` is the real
 * difference between base and payable sum after rounding.
 */
export function quoteCode(denomination: number, discountPercent: number, usdRub: number = CODES_REFERENCE_USD_RUB): CodeQuote {
  if (!isCodeDenomination(denomination)) throw new RangeError(`Unsupported code denomination: ${denomination}`);
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > CODE_MAX_DISCOUNT_PERCENT) {
    throw new RangeError(`Unsupported code discount: ${discountPercent}`);
  }
  const baseAmountKopecks = codePrice(denomination, usdRub) * 100;
  const exact = baseAmountKopecks - Math.round((baseAmountKopecks * discountPercent) / 100);
  const finalAmountKopecks = roundCodePriceKopecks(exact);
  return {
    denomination,
    policyVersion: CODES_PRICING_POLICY_VERSION,
    baseAmountKopecks,
    discountPercent,
    discountKopecks: baseAmountKopecks - finalAmountKopecks,
    finalAmountKopecks,
    usdRub: sanitizeCodesUsdRub(usdRub),
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
