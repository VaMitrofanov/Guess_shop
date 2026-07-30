import { calculatePriceQuote } from "@/lib/price-quote";

describe("price quote calculation", () => {
  const now = new Date("2026-07-12T10:00:00.000Z");

  it("uses the shared retail policy and stores money in kopecks", () => {
    expect(calculatePriceQuote(500, null, now)).toMatchObject({
      requestedRobux: 500,
      bonusRobux: 0,
      gamepassPriceRobux: 715,
      baseAmountKopecks: 55_300,
      discountKopecks: 0,
      finalAmountKopecks: 55_300,
    });
  });

  it("applies only an active bonus and caps a ruble discount at the price", () => {
    expect(calculatePriceQuote(100, {
      balance: 25,
      bonusExpiresAt: new Date("2026-07-13T10:00:00.000Z"),
      rubleDiscount: 999,
    }, now)).toMatchObject({
      bonusRobux: 25,
      gamepassPriceRobux: 179,
      baseAmountKopecks: 14_400,
      discountKopecks: 14_400,
      finalAmountKopecks: 0,
    });
  });

  it("does not apply an expired bonus", () => {
    expect(calculatePriceQuote(1_000, {
      balance: 100,
      bonusExpiresAt: new Date("2026-07-12T09:59:59.000Z"),
      rubleDiscount: 0,
    }, now).bonusRobux).toBe(0);
  });

  it("rejects values outside the channel limits", () => {
    expect(() => calculatePriceQuote(99, null, now)).toThrow(RangeError);
    expect(() => calculatePriceQuote(100_001, null, now)).toThrow(RangeError);
    expect(() => calculatePriceQuote(100.5, null, now)).toThrow(RangeError);
  });
});
