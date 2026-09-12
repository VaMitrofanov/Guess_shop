import { DIRECT_PRICES } from "@/lib/retail-pricing";
import {
  CODES_PRICING_POLICY_VERSION,
  CODE_DENOMINATIONS,
  CODE_PRICES,
  codePrice,
  getCodePriceBreakdown,
  isCodeDenomination,
} from "@/lib/codes-pricing";

describe("activation code pricing", () => {
  test("matches the owner-approved price list exactly", () => {
    expect(CODE_PRICES).toEqual({
      100: 309,
      200: 309,
      800: 999,
      1000: 1199,
      2000: 2299,
      4500: 4899,
      10000: 9899,
    });
  });

  test("carries its own policy version, never the gamepass one", () => {
    expect(CODES_PRICING_POLICY_VERSION).toBe("retail-codes-v1");
  });

  test("prices a code above the gamepass price for every shared amount", () => {
    // Codes cost more because they are instant; if this ever inverts we would be
    // selling the premium product below the cheaper one.
    for (const amount of CODE_DENOMINATIONS) {
      const gamepass = DIRECT_PRICES[amount];
      if (gamepass === undefined) continue;
      expect(codePrice(amount)).toBeGreaterThan(gamepass);
    }
  });

  test("gets cheaper per R$ as the denomination grows", () => {
    // 100 and 200 share a price by owner decision, so the rate only has to be
    // non-increasing rather than strictly falling.
    const rates = CODE_DENOMINATIONS.map((amount) => codePrice(amount) / amount);
    for (let i = 1; i < rates.length; i += 1) {
      expect(rates[i]).toBeLessThanOrEqual(rates[i - 1]);
    }
  });

  test("sells only real denominations, not arbitrary amounts", () => {
    expect(isCodeDenomination(500)).toBe(false);
    expect(isCodeDenomination(1500)).toBe(false);
    expect(isCodeDenomination(999)).toBe(false);
    expect(isCodeDenomination(0)).toBe(false);
    expect(isCodeDenomination(-100)).toBe(false);
    expect(isCodeDenomination(100.5)).toBe(false);
  });

  test("prices an unsupported amount at zero so no UI can imply it is buyable", () => {
    expect(codePrice(500)).toBe(0);
    expect(codePrice(123456)).toBe(0);
    expect(getCodePriceBreakdown(500)).toEqual({
      amountRobux: 0,
      rubles: 0,
      rubPerRobux: 0,
      policyVersion: "retail-codes-v1",
    });
  });

  test("breaks down a supported denomination for the storefront", () => {
    expect(getCodePriceBreakdown(1000)).toEqual({
      amountRobux: 1000,
      rubles: 1199,
      rubPerRobux: 1.199,
      policyVersion: "retail-codes-v1",
    });
  });

  test("exposes denominations sorted ascending for stable UI order", () => {
    expect([...CODE_DENOMINATIONS]).toEqual([100, 200, 800, 1000, 2000, 4500, 10000]);
  });

  test("cannot be mutated at runtime", () => {
    expect(() => {
      (CODE_PRICES as Record<number, number>)[1000] = 1;
    }).toThrow();
  });
});
