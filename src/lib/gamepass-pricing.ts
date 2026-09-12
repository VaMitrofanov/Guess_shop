/**
 * Pure Game Pass pricing calculator shared by the admin UI and the CLI script.
 * All money arithmetic uses integer kopecks; the recommended buyer price is
 * rounded up to whole rubles so rounding can never push margin below target.
 */

export type UsnMode = "income" | "income-minus-expenses";

export interface GamepassPricingRates {
  /** RUB paid for one USD. */
  usdToRub: number;
  /** Supplier USD price for 1000 gross R$. */
  rateUsdPer1k: number;
  /** Roblox commission withheld from the Game Pass, percent. */
  taxPct: number;
  /** Acquiring commission from the buyer payment, percent. */
  acquiringPct: number;
  /** Minimum acquiring commission, kopecks. Defaults to the T-Bank 3.49 RUB floor. */
  acquiringMinKopecks?: number;
  /** Optional receipt/fiscal service commission, percent. */
  receiptPct: number;
  /** USN tax rate, percent. */
  usnPct: number;
  /** USN tax base. */
  usnMode: UsnMode;
}

export const DEFAULT_FEE_RATES = {
  acquiringPct: 3.49,
  acquiringMinKopecks: 349,
  receiptPct: 0,
  usnPct: 6,
  usnMode: "income" as UsnMode,
};

export interface GamepassPriceQuote {
  netRobux: number;
  grossRobux: number;
  robloxCommissionRobux: number;
  buyerPaymentKopecks: number;
  purchaseCostKopecks: number;
  acquiringKopecks: number;
  usnKopecks: number;
  profitKopecks: number;
  marginPct: number;
}

export const ratesValid = (rates: GamepassPricingRates): boolean =>
  Number.isFinite(rates.usdToRub) && rates.usdToRub > 0 &&
  Number.isFinite(rates.rateUsdPer1k) && rates.rateUsdPer1k > 0 &&
  Number.isFinite(rates.taxPct) && rates.taxPct >= 0 && rates.taxPct < 100 &&
  Number.isFinite(rates.acquiringPct) && rates.acquiringPct >= 0 && rates.acquiringPct < 100 &&
  (rates.acquiringMinKopecks === undefined ||
    (Number.isFinite(rates.acquiringMinKopecks) && rates.acquiringMinKopecks >= 0)) &&
  Number.isFinite(rates.receiptPct) && rates.receiptPct >= 0 && rates.receiptPct < 100 &&
  Number.isFinite(rates.usnPct) && rates.usnPct >= 0 && rates.usnPct < 100;

/** Gross Game Pass price required for the seller to receive `netRobux`. */
export const grossFor = (netRobux: number, rates: GamepassPricingRates): number =>
  ratesValid(rates) && Number.isFinite(netRobux) && netRobux > 0
    ? Math.ceil(Math.round(netRobux) / (1 - rates.taxPct / 100))
    : 0;

/** Supplier cost of a gross Game Pass amount, in integer kopecks. */
export const costKopFor = (grossRobux: number, rates: GamepassPricingRates): number =>
  ratesValid(rates) && Number.isFinite(grossRobux) && grossRobux > 0
    ? Math.round((Math.round(grossRobux) / 1000) * rates.rateUsdPer1k * rates.usdToRub * 100)
    : 0;

/** Acquiring and receipt commissions from the full buyer payment. */
export const acquiringKopFor = (buyerPaymentKopecks: number, rates: GamepassPricingRates): number =>
  ratesValid(rates) && Number.isFinite(buyerPaymentKopecks) && buyerPaymentKopecks > 0
    ? (rates.acquiringPct > 0
        ? Math.max(
            Math.round(rates.acquiringMinKopecks ?? 349),
            Math.round((buyerPaymentKopecks * rates.acquiringPct) / 100),
          )
        : 0) + Math.round((buyerPaymentKopecks * rates.receiptPct) / 100)
    : 0;

/** USN tax for the configured base. */
export function usnKopFor(
  buyerPaymentKopecks: number,
  expensesKopecks: number,
  rates: GamepassPricingRates,
): number {
  if (!ratesValid(rates) || buyerPaymentKopecks <= 0) return 0;
  const base = rates.usnMode === "income"
    ? buyerPaymentKopecks
    : Math.max(0, buyerPaymentKopecks - expensesKopecks);
  return Math.round((base * rates.usnPct) / 100);
}

/** Complete net-profit breakdown for an already selected buyer payment. */
export function quoteGamepassPayment(
  netRobux: number,
  buyerPaymentKopecks: number,
  rates: GamepassPricingRates,
): GamepassPriceQuote | null {
  const normalizedNet = Math.round(netRobux);
  const normalizedPayment = Math.round(buyerPaymentKopecks);
  if (!ratesValid(rates) || normalizedNet <= 0 || normalizedPayment <= 0) return null;

  const grossRobux = grossFor(normalizedNet, rates);
  const purchaseCostKopecks = costKopFor(grossRobux, rates);
  const acquiringKopecks = acquiringKopFor(normalizedPayment, rates);
  const usnKopecks = usnKopFor(
    normalizedPayment,
    purchaseCostKopecks + acquiringKopecks,
    rates,
  );
  const profitKopecks = normalizedPayment - purchaseCostKopecks - acquiringKopecks - usnKopecks;

  return {
    netRobux: normalizedNet,
    grossRobux,
    robloxCommissionRobux: grossRobux - normalizedNet,
    buyerPaymentKopecks: normalizedPayment,
    purchaseCostKopecks,
    acquiringKopecks,
    usnKopecks,
    profitKopecks,
    marginPct: (profitKopecks / normalizedPayment) * 100,
  };
}

/**
 * Finds the smallest whole-ruble buyer payment whose net-profit margin is at
 * least `targetMarginPct`. Returns null when the requested margin is not
 * reachable with the configured percentage deductions.
 */
export function priceForTargetMargin(
  netRobux: number,
  targetMarginPct: number,
  rates: GamepassPricingRates,
): GamepassPriceQuote | null {
  if (!ratesValid(rates) || !Number.isFinite(targetMarginPct) || targetMarginPct < 0 || targetMarginPct >= 100) {
    return null;
  }

  const grossRobux = grossFor(netRobux, rates);
  if (grossRobux <= 0) return null;
  const purchaseCostKopecks = costKopFor(grossRobux, rates);
  const target = targetMarginPct / 100;
  const meetsTarget = (rubles: number) => {
    const quote = quoteGamepassPayment(netRobux, rubles * 100, rates);
    return quote !== null && quote.profitKopecks / quote.buyerPaymentKopecks + 1e-12 >= target;
  };

  let lowRub = 1;
  let highRub = Math.max(100, Math.ceil(purchaseCostKopecks / 100));
  const maxRub = 1_000_000_000;
  while (highRub < maxRub && !meetsTarget(highRub)) {
    highRub = Math.min(maxRub, highRub * 2);
  }
  if (!meetsTarget(highRub)) return null;

  while (lowRub < highRub) {
    const middleRub = Math.floor((lowRub + highRub) / 2);
    if (meetsTarget(middleRub)) highRub = middleRub;
    else lowRub = middleRub + 1;
  }
  return quoteGamepassPayment(netRobux, lowRub * 100, rates);
}
