import {
  DIRECT_PRICES,
  RETAIL_PRICING_POLICY_VERSION,
  directPrice,
  getRetailPriceBreakdown,
} from "../../bots/shared/retail-pricing";

describe("canonical retail pricing", () => {
  it("keeps every published TG/VK pack at its exact price", () => {
    for (const [amount, price] of Object.entries(DIRECT_PRICES)) {
      expect(directPrice(Number(amount))).toBe(price);
    }
  });

  it("keeps contractual tier boundaries and the small-order surcharge", () => {
    expect(directPrice(499)).toBe(559);
    expect(directPrice(500)).toBe(450);
    expect(directPrice(999)).toBe(899);
    expect(directPrice(1000)).toBe(800);
    expect(directPrice(1499)).toBe(1199);
    expect(directPrice(1500)).toBe(1050);
  });

  it("returns a versioned, inspectable price breakdown", () => {
    expect(getRetailPriceBreakdown(400)).toEqual({
      amountRobux: 400,
      rubles: 460,
      rubPerRobux: 1,
      smallOrderSurcharge: 60,
      policyVersion: RETAIL_PRICING_POLICY_VERSION,
    });
  });
});
