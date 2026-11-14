import { DIRECT_PRICES } from "@/lib/retail-pricing";
import {
  CODES_PRICING_POLICY_VERSION,
  CODE_DENOMINATIONS,
  CODE_PRICES,
  codeDiscountPercent,
  codeDiscountProgress,
  codePrice,
  formatRubKopecks,
  getCodePriceBreakdown,
  isCodeDenomination,
  quoteCode,
  roundCodePriceKopecks,
} from "@/lib/codes-pricing";

describe("activation code pricing (v2, 14.11.2026)", () => {
  test("matches the owner-approved base price list exactly", () => {
    expect(CODE_PRICES).toEqual({
      100: 239,
      200: 349,
      800: 999,
      1000: 1199,
      2000: 2399,
      2500: 2999,
      4500: 5219,
      10000: 10529,
    });
  });

  test("800 R$ costs 999 ₽ without a discount", () => {
    expect(quoteCode(800, 0).finalAmountKopecks).toBe(99_900);
  });

  test("the maximum discount, rounded to whole rubles by the owner's rule", () => {
    const expected: Record<number, number> = {
      100: 22_800, // 227,05 → 228
      200: 33_200, // 331,55 → 332
      800: 94_900, // 949,05 → 949 (ends in 9 — kopecks dropped)
      1000: 113_900, // 1 139,05 → 1 139
      2000: 227_900, // 2 279,05 → 2 279
      2500: 284_900, // 2 849,05 → 2 849
      4500: 495_900, // 4 958,05 → 4 959
      10000: 1_000_300, // 10 002,55 → 10 003
    };
    for (const denomination of CODE_DENOMINATIONS) {
      expect(quoteCode(denomination, 5).finalAmountKopecks).toBe(expected[denomination]);
    }
  });

  test("rounding: up to the next ruble, unless the ruble part ends in 9", () => {
    expect(roundCodePriceKopecks(399_903)).toBe(399_900);
    expect(roundCodePriceKopecks(354_204)).toBe(354_300);
    expect(roundCodePriceKopecks(98_901)).toBe(98_900);
    expect(roundCodePriceKopecks(23_661)).toBe(23_700);
    expect(roundCodePriceKopecks(99_900)).toBe(99_900);
  });

  test("every pack × every discount 0–5 % is a whole ruble within a ruble of the exact price", () => {
    for (const denomination of CODE_DENOMINATIONS) {
      for (let percent = 0; percent <= 5; percent += 1) {
        const quote = quoteCode(denomination, percent);
        const base = CODE_PRICES[denomination] * 100;
        const exact = base - (base * percent) / 100;
        expect(quote.finalAmountKopecks % 100).toBe(0);
        expect(quote.baseAmountKopecks).toBe(base);
        expect(Math.abs(quote.finalAmountKopecks - exact)).toBeLessThan(100);
        expect(quote.discountKopecks).toBe(base - quote.finalAmountKopecks);
        expect(quote.policyVersion).toBe("retail-codes-v2");
      }
    }
    expect(formatRubKopecks(quoteCode(1000, 5).finalAmountKopecks).replace(/\s/g, " ")).toBe("1 139 ₽");
    expect(formatRubKopecks(quoteCode(800, 0).finalAmountKopecks)).toBe("999 ₽");
  });

  test("rejects discounts and denominations outside the policy", () => {
    expect(() => quoteCode(500, 1)).toThrow(RangeError);
    expect(() => quoteCode(800, 6)).toThrow(RangeError);
    expect(() => quoteCode(800, -1)).toThrow(RangeError);
    expect(() => quoteCode(800, 1.5)).toThrow(RangeError);
  });

  test("carries its own policy version, never the gamepass one", () => {
    expect(CODES_PRICING_POLICY_VERSION).toBe("retail-codes-v2");
  });

  test("prices a code above the gamepass price for every shared amount", () => {
    for (const amount of CODE_DENOMINATIONS) {
      const gamepass = DIRECT_PRICES[amount];
      if (gamepass === undefined) continue;
      expect(codePrice(amount)).toBeGreaterThan(gamepass);
    }
  });

  test("sells only real denominations, not arbitrary amounts", () => {
    expect(isCodeDenomination(2500)).toBe(true);
    expect(isCodeDenomination(500)).toBe(false);
    expect(isCodeDenomination(1500)).toBe(false);
    expect(isCodeDenomination(0)).toBe(false);
    expect(isCodeDenomination(100.5)).toBe(false);
  });

  test("prices an unsupported amount at zero so no UI can imply it is buyable", () => {
    expect(codePrice(500)).toBe(0);
    expect(getCodePriceBreakdown(500)).toEqual({ amountRobux: 0, rubles: 0, rubPerRobux: 0, policyVersion: "retail-codes-v2" });
  });

  test("exposes all eight denominations sorted ascending", () => {
    expect([...CODE_DENOMINATIONS]).toEqual([100, 200, 800, 1000, 2000, 2500, 4500, 10000]);
  });

  test("cannot be mutated at runtime", () => {
    expect(() => {
      (CODE_PRICES as Record<number, number>)[1000] = 1;
    }).toThrow();
  });
});

describe("code discount ladder", () => {
  test("guest pays the base price; registration gives 1 % at once", () => {
    expect(codeDiscountPercent({ registered: false, invitedCount: 99 })).toBe(0);
    expect(codeDiscountPercent({ registered: true, invitedCount: 0 })).toBe(1);
  });

  test("thresholds 3/10/20/30 replace each other and cap at 5 %", () => {
    const cases: Array<[number, number]> = [[2, 1], [3, 2], [9, 2], [10, 3], [19, 3], [20, 4], [29, 4], [30, 5], [500, 5]];
    for (const [invited, percent] of cases) {
      expect(codeDiscountPercent({ registered: true, invitedCount: invited })).toBe(percent);
    }
  });

  test("progress says how many buyers are left to the next tier", () => {
    expect(codeDiscountProgress(6)).toMatchObject({ percent: 2, next: { percent: 3, invited: 10, remaining: 4 } });
    expect(codeDiscountProgress(0)).toMatchObject({ percent: 1, next: { percent: 2, remaining: 3 }, progress: 0 });
    expect(codeDiscountProgress(30)).toMatchObject({ percent: 5, next: null, progress: 1 });
  });
});
