import {
  DIRECT_PRICES,
  RETAIL_PRICING_POLICY_VERSION,
  customerPriceForTargetNet,
  directPrice,
  getRetailPriceBreakdown,
  retainedAfterPaymentCosts,
  targetNetRate,
} from "../../bots/shared/retail-pricing";

describe("canonical retail pricing", () => {
  it("keeps the owner-approved target-net curve anchors", () => {
    expect(targetNetRate(1)).toBeCloseTo(3);
    expect(targetNetRate(10)).toBeCloseTo(2);
    expect(targetNetRate(50)).toBeCloseTo(1.6);
    expect(targetNetRate(100)).toBeCloseTo(1.3);
    expect(targetNetRate(500)).toBeCloseTo(1);
    expect(targetNetRate(1000)).toBeCloseTo(0.9);
    expect(targetNetRate(3000)).toBeCloseTo(0.8);
    expect(targetNetRate(5000)).toBeCloseTo(0.7);
    expect(targetNetRate(10_000)).toBeCloseTo(0.7);
  });

  it("grosses up the retained target for 6% USN and max(3.49 RUB, 3.49%)", () => {
    expect(customerPriceForTargetNet(80)).toBeCloseTo((80 + 3.49) / 0.94);
    expect(customerPriceForTargetNet(500)).toBeCloseTo(500 / 0.9051);
    expect(directPrice(50)).toBe(89);
    expect(directPrice(500)).toBe(553);
  });

  it("rounds up and never retains less than the dynamic target", () => {
    for (let amount = 100; amount <= 100_000; amount += 1) {
      const target = amount * targetNetRate(amount);
      expect(retainedAfterPaymentCosts(directPrice(amount)) + 1e-9).toBeGreaterThanOrEqual(target);
    }
  });

  it("derives every published pack from the same curve", () => {
    expect(DIRECT_PRICES).toEqual({
      100: 144,
      200: 271,
      300: 382,
      400: 476,
      500: 553,
      800: 831,
      1000: 995,
      1200: 1180,
      1500: 1451,
      2000: 1879,
    });
  });

  it("returns the buyer-facing rate, not the internal retained rate", () => {
    expect(getRetailPriceBreakdown(500)).toEqual({
      amountRobux: 500,
      rubles: 553,
      rubPerRobux: 1.106,
      targetNetRate: 1,
      targetNetRubles: 500,
      paymentOverheadRubles: 53,
      smallOrderSurcharge: 0,
      policyVersion: RETAIL_PRICING_POLICY_VERSION,
    });
  });
});
