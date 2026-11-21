import {
  DIRECT_PRICES,
  RETAIL_PRICING_POLICY_VERSION,
  customerPriceForTargetNet,
  directPrice,
  getRetailPriceBreakdown,
  retainedAfterPaymentCosts,
} from "../../bots/shared/retail-pricing";

describe("canonical retail pricing", () => {
  it("applies the owner's progressive brackets: 1 ₽ up to 200, 0.9 up to 500, 0.8 above", () => {
    expect(directPrice(1)).toBe(1);
    expect(directPrice(200)).toBe(200);
    expect(directPrice(500)).toBe(200 + 300 * 0.9);
    expect(directPrice(1000)).toBe(470 + 500 * 0.8);
    expect(directPrice(4218)).toBe(3445);
  });

  it("keeps the old curve for large orders where it is cheaper (down to ≈0.77 ₽/R$)", () => {
    expect(directPrice(4219)).toBe(3445);
    expect(directPrice(5000)).toBe(3867);
    expect(directPrice(10_000)).toBe(7734);
  });

  it("rounds up to whole rubles", () => {
    expect(directPrice(201)).toBe(201);
    expect(directPrice(499)).toBe(470);
    expect(directPrice(501)).toBe(471);
  });

  it("never charges less for a bigger order", () => {
    let previous = 0;
    for (let amount = 1; amount <= 100_000; amount += 1) {
      const price = directPrice(amount);
      expect(price).toBeGreaterThanOrEqual(previous);
      previous = price;
    }
  });

  it("keeps the payment-cost helpers consistent", () => {
    expect(customerPriceForTargetNet(80)).toBeCloseTo((80 + 3.49) / 0.94);
    expect(retainedAfterPaymentCosts(customerPriceForTargetNet(500))).toBeCloseTo(500);
  });

  it("derives every published pack from the same brackets", () => {
    expect(DIRECT_PRICES).toEqual({
      100: 100,
      200: 200,
      300: 290,
      400: 380,
      500: 470,
      800: 710,
      1000: 870,
      1200: 1030,
      1500: 1270,
      2000: 1670,
    });
  });

  it("returns the buyer-facing rate and what remains after payment costs", () => {
    expect(getRetailPriceBreakdown(500)).toEqual({
      amountRobux: 500,
      rubles: 470,
      rubPerRobux: 0.94,
      targetNetRate: 0.8508,
      targetNetRubles: 425.4,
      paymentOverheadRubles: 44.6,
      smallOrderSurcharge: 0,
      policyVersion: RETAIL_PRICING_POLICY_VERSION,
    });
  });
});
