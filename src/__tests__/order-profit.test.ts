import { buildOrderProfitSnapshot } from "@/lib/order-profit";

describe("buildOrderProfitSnapshot", () => {
  it("pins exact cost and profit in kopecks", () => {
    expect(buildOrderProfitSnapshot(
      { saleAmountKopecks: 240_000 },
      { purchaseRate: 3.5, usdToRub: 90 },
      1_000,
    )).toEqual({
      purchaseRate: 3.5,
      purchaseRobuxAmount: 1_000,
      purchaseRateUsdPer1k: 3.5,
      purchaseUsdToRub: 90,
      purchaseCostKopecks: 31_500,
      profitKopecks: 208_500,
    });
  });

  it("does not invent exact profit without a sale snapshot", () => {
    expect(buildOrderProfitSnapshot({}, { purchaseRate: 4, usdToRub: 100 }, 500))
      .toEqual(expect.not.objectContaining({ profitKopecks: expect.anything() }));
  });

  it("returns null when a required purchase rate is missing", () => {
    expect(buildOrderProfitSnapshot({ saleAmountKopecks: 100 }, { purchaseRate: null, usdToRub: 90 }, 500)).toBeNull();
  });
});
