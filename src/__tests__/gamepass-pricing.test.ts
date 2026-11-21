import {
  priceForTargetMargin,
  quoteGamepassPayment,
  type GamepassPricingRates,
} from "@/lib/gamepass-pricing";

const RATES: GamepassPricingRates = {
  usdToRub: 81.05,
  rateUsdPer1k: 4.3,
  taxPct: 30,
  acquiringPct: 3.49,
  receiptPct: 0,
  usnPct: 6,
  usnMode: "income",
};

describe("Game Pass price calculator", () => {
  it("shows the complete current-payment breakdown", () => {
    const quote = quoteGamepassPayment(1000, 99_500, RATES)!;

    expect(quote.grossRobux).toBe(1429);
    expect(quote.robloxCommissionRobux).toBe(429);
    expect(quote.purchaseCostKopecks).toBe(49_803);
    expect(quote.acquiringKopecks).toBe(3_473);
    expect(quote.usnKopecks).toBe(5_970);
    expect(quote.profitKopecks).toBe(40_254);
    expect(quote.marginPct).toBeCloseTo(40.456, 3);
  });

  it("keeps target margin when either currency rate changes", () => {
    const target = 40.45;
    const current = priceForTargetMargin(1000, target, RATES)!;
    const moreExpensiveUsd = priceForTargetMargin(1000, target, { ...RATES, usdToRub: 90 })!;
    const moreExpensiveRobux = priceForTargetMargin(1000, target, { ...RATES, rateUsdPer1k: 4.7 })!;

    expect(current.buyerPaymentKopecks).toBe(99_500);
    expect(moreExpensiveUsd.buyerPaymentKopecks).toBeGreaterThan(current.buyerPaymentKopecks);
    expect(moreExpensiveRobux.buyerPaymentKopecks).toBeGreaterThan(current.buyerPaymentKopecks);
    expect(moreExpensiveUsd.marginPct).toBeGreaterThanOrEqual(target);
    expect(moreExpensiveRobux.marginPct).toBeGreaterThanOrEqual(target);
  });

  it("rounds up to the smallest whole-ruble safe price", () => {
    const quote = priceForTargetMargin(1000, 40.45, RATES)!;
    const oneRubleLess = quoteGamepassPayment(1000, quote.buyerPaymentKopecks - 100, RATES)!;

    expect(quote.buyerPaymentKopecks % 100).toBe(0);
    expect(quote.marginPct).toBeGreaterThanOrEqual(40.45);
    expect(oneRubleLess.marginPct).toBeLessThan(40.45);
  });

  it("uses the acquiring minimum on payments below 100 RUB", () => {
    const quote = quoteGamepassPayment(1, 5_000, RATES)!;
    expect(quote.acquiringKopecks).toBe(349);
  });

  it("rejects a margin above the maximum left after proportional deductions", () => {
    expect(priceForTargetMargin(1000, 95, RATES)).toBeNull();
  });
});
