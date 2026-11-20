import { DIRECT_PRICES } from "@/lib/retail-pricing";
import {
  CODES_LEGACY_POLICY_VERSION,
  CODES_PRICING_POLICY_VERSION,
  CODES_REFERENCE_USD_RUB,
  CODE_DENOMINATIONS,
  CODE_PRICES,
  CODE_SUPPLIER_DENOMINATIONS,
  codeComponents,
  codeDiscountPercent,
  codeDiscountProgress,
  codePrice,
  formatRubKopecks,
  getCodePriceBreakdown,
  isCodeDenomination,
  isSupplierCodeDenomination,
  packsAvailable,
  quoteCode,
  roundCodePriceKopecks,
  sanitizeCodesUsdRub,
} from "@/lib/codes-pricing";

describe("activation code pricing (v3, 20.11.2026)", () => {
  test("matches the owner-approved price list at 85 ₽/$ exactly", () => {
    expect(CODE_PRICES).toEqual({
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
    for (const denomination of CODE_DENOMINATIONS) {
      expect(codePrice(denomination, CODES_REFERENCE_USD_RUB)).toBe(CODE_PRICES[denomination]);
      expect(codePrice(denomination)).toBe(CODE_PRICES[denomination]);
    }
  });

  test("follows the dollar: small packs smoothly, packs from 1 000 R$ to the nearest …9", () => {
    expect(codePrice(10, 86)).toBe(60); // 59,69
    expect(codePrice(800, 86)).toBe(1011); // 1 010,75 — плавно, хоть и больше 1 000 ₽
    expect(codePrice(1000, 86)).toBe(1209); // 1 213,1 → …9
    expect(codePrice(10000, 80)).toBe(9879); // 9 881,4 → …9
    expect(codePrice(2000, 90)).toBe(2489); // 2 487,2 → …9
    for (const denomination of CODE_DENOMINATIONS.filter((d) => d >= 1000)) {
      for (const rate of [70, 81.93, 88, 99.5]) expect(codePrice(denomination, rate) % 10).toBe(9);
    }
  });

  test("keeps the margin in percent: the price moves with the rate", () => {
    for (const denomination of CODE_DENOMINATIONS) {
      const up = codePrice(denomination, 95);
      const down = codePrice(denomination, 75);
      expect(up).toBeGreaterThan(CODE_PRICES[denomination]);
      expect(down).toBeLessThan(CODE_PRICES[denomination]);
      expect(Math.abs(up - (CODE_PRICES[denomination] * 95) / 85)).toBeLessThanOrEqual(5);
    }
  });

  test("a mistyped rate falls back to the reference instead of selling at a tenth", () => {
    expect(sanitizeCodesUsdRub(8.5)).toBe(85);
    expect(sanitizeCodesUsdRub(850)).toBe(85);
    expect(sanitizeCodesUsdRub(null)).toBe(85);
    expect(sanitizeCodesUsdRub("abc")).toBe(85);
    expect(sanitizeCodesUsdRub(81.93)).toBe(81.93);
    expect(codePrice(1000, 8.5)).toBe(1199);
  });

  test("the quote carries the rate and the rate-scaled base price", () => {
    const quote = quoteCode(1000, 0, 86);
    expect(quote).toMatchObject({ baseAmountKopecks: 120_900, finalAmountKopecks: 120_900, usdRub: 86 });
    expect(quoteCode(800, 0).finalAmountKopecks).toBe(99_900);
  });

  test("the maximum discount at the reference rate, rounded by the owner's rule", () => {
    const expected: Record<number, number> = {
      10: 5_700, // 56,05 → 57
      100: 21_800, // 217,55 → 218
      199: 34_200, // 341,05 → 342
      800: 94_900, // 949,05 → 949
      1000: 113_900, // 1 139,05 → 1 139
      2000: 223_200, // 2 231,55 → 2 232
      10000: 997_500, // 9 974,05 → 9 975
    };
    for (const [denomination, kopecks] of Object.entries(expected)) {
      expect(quoteCode(Number(denomination), 5).finalAmountKopecks).toBe(kopecks);
    }
  });

  test("rounding: up to the next ruble, unless the ruble part ends in 9", () => {
    expect(roundCodePriceKopecks(399_903)).toBe(399_900);
    expect(roundCodePriceKopecks(354_204)).toBe(354_300);
    expect(roundCodePriceKopecks(98_901)).toBe(98_900);
    expect(roundCodePriceKopecks(23_661)).toBe(23_700);
    expect(roundCodePriceKopecks(99_900)).toBe(99_900);
  });

  test("every pack × every discount 0–5 % × several rates is a whole ruble within a ruble of the exact price", () => {
    for (const rate of [85, 81.93, 92]) {
      for (const denomination of CODE_DENOMINATIONS) {
        for (let percent = 0; percent <= 5; percent += 1) {
          const quote = quoteCode(denomination, percent, rate);
          const base = codePrice(denomination, rate) * 100;
          const exact = base - (base * percent) / 100;
          expect(quote.finalAmountKopecks % 100).toBe(0);
          expect(quote.baseAmountKopecks).toBe(base);
          expect(Math.abs(quote.finalAmountKopecks - exact)).toBeLessThan(100);
          expect(quote.discountKopecks).toBe(base - quote.finalAmountKopecks);
          expect(quote.policyVersion).toBe("retail-codes-v3");
        }
      }
    }
    expect(formatRubKopecks(quoteCode(1000, 5).finalAmountKopecks).replace(/\s/g, " ")).toBe("1 139 ₽");
    expect(formatRubKopecks(quoteCode(800, 0).finalAmountKopecks)).toBe("999 ₽");
  });

  test("rejects discounts and denominations outside the policy", () => {
    expect(() => quoteCode(200, 1)).toThrow(RangeError);
    expect(() => quoteCode(1500, 1)).toThrow(RangeError);
    expect(() => quoteCode(800, 6)).toThrow(RangeError);
    expect(() => quoteCode(800, -1)).toThrow(RangeError);
    expect(() => quoteCode(800, 1.5)).toThrow(RangeError);
  });

  test("carries its own policy version, never the gamepass one", () => {
    expect(CODES_PRICING_POLICY_VERSION).toBe("retail-codes-v3");
  });

  test("prices a code above the gamepass price for every shared amount", () => {
    for (const amount of CODE_DENOMINATIONS) {
      const gamepass = DIRECT_PRICES[amount];
      if (gamepass === undefined) continue;
      expect(codePrice(amount)).toBeGreaterThan(gamepass);
    }
  });

  test("sells only real packs, not arbitrary amounts; 200 is now sold as 199", () => {
    expect(isCodeDenomination(2500)).toBe(true);
    expect(isCodeDenomination(199)).toBe(true);
    expect(isCodeDenomination(200)).toBe(false);
    expect(isCodeDenomination(1500)).toBe(false);
    expect(isCodeDenomination(0)).toBe(false);
    expect(isCodeDenomination(100.5)).toBe(false);
  });

  test("prices an unsupported amount at zero so no UI can imply it is buyable", () => {
    expect(codePrice(1500)).toBe(0);
    expect(getCodePriceBreakdown(1500)).toEqual({ amountRobux: 0, rubles: 0, rubPerRobux: 0, policyVersion: "retail-codes-v3" });
  });

  test("exposes all twelve packs sorted ascending", () => {
    expect([...CODE_DENOMINATIONS]).toEqual([10, 50, 100, 199, 500, 800, 1000, 2000, 2500, 4500, 5250, 10000]);
  });

  test("cannot be mutated at runtime", () => {
    expect(() => {
      (CODE_PRICES as Record<number, number>)[1000] = 1;
    }).toThrow();
  });
});

describe("packs made of supplier codes", () => {
  test("199 is the supplier's 200, 2 000 is two codes of 1 000", () => {
    expect(codeComponents(199)).toEqual([200]);
    expect(codeComponents(2000)).toEqual([1000, 1000]);
    expect(codeComponents(800)).toEqual([800]);
  });

  test("orders priced by v2 stay one code of their own face value", () => {
    expect(codeComponents(2000, CODES_LEGACY_POLICY_VERSION)).toEqual([2000]);
    expect(codeComponents(200, CODES_LEGACY_POLICY_VERSION)).toEqual([200]);
    expect(codeComponents(2000, "retail-codes-v3")).toEqual([1000, 1000]);
  });

  test("the stock holds supplier denominations only", () => {
    expect([...CODE_SUPPLIER_DENOMINATIONS]).toEqual([10, 50, 100, 200, 500, 800, 1000, 2500, 4500, 5250, 10000]);
    expect(isSupplierCodeDenomination(200)).toBe(true);
    expect(isSupplierCodeDenomination(199)).toBe(false);
    expect(isSupplierCodeDenomination(2000)).toBe(false);
  });

  test("packs available count each component with multiplicity", () => {
    const stock = new Map([[1000, 3], [200, 2]]);
    expect(packsAvailable(2000, stock)).toBe(1);
    expect(packsAvailable(1000, stock)).toBe(3);
    expect(packsAvailable(199, stock)).toBe(2);
    expect(packsAvailable(800, stock)).toBe(0);
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
