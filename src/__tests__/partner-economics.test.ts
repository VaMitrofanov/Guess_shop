import {
  computePartnerSettlement,
  partnerNetRobux,
  partnerOrderRateUsdtPer1000,
  partnerPolicyValid,
  settlementLedgerData,
} from "@/lib/partner-economics";

describe("partner economics", () => {
  test("uses a per-order Sheets rate and falls back for legacy/manual tasks", () => {
    expect(partnerOrderRateUsdtPer1000({ sheetRateUsdtPer1000: 5.7 }, 5.3)).toBe(5.7);
    expect(partnerOrderRateUsdtPer1000({ sheetRateUsdtPer1000: null }, 5.3)).toBe(5.3);
    expect(partnerOrderRateUsdtPer1000({ sheetRateUsdtPer1000: -1 }, 5.3)).toBe(5.3);
  });

  test("matches the Anton sheet formula SUMPRODUCT(C, F) / 1000", () => {
    const rows = [6000, 1200, 90, 1000].map((grossRobux) => computePartnerSettlement({
      grossRobux,
      saleRateUsdtPer1000: 5.3,
      purchaseRateUsdtPer1000: 4.7,
      rateBasis: "DIRTY",
      robloxFeePct: 30,
    }));

    expect(rows.map((row) => row.revenueUsdt)).toEqual([31.8, 6.36, 0.477, 5.3]);
    expect(rows.reduce((sum, row) => sum + row.revenueUsdt, 0)).toBe(43.937);
    expect(rows.reduce((sum, row) => sum + row.grossRobux, 0)).toBe(8290);
  });

  test("preserves the legacy dirty-basis calculation for history", () => {
    const row = computePartnerSettlement({
      grossRobux: 1000,
      saleRateUsdtPer1000: 5.05,
      purchaseRateUsdtPer1000: 4.3,
      rateBasis: "DIRTY",
      robloxFeePct: 30,
    });

    expect(row.netRobux).toBe(700);
    expect(row.revenueUsdt).toBe(5.05);
    expect(row.costUsdt).toBe(4.3);
    expect(row.profitUsdt).toBe(0.75);
  });

  test("an actual ledger amount remains authoritative", () => {
    const row = computePartnerSettlement({
      grossRobux: 1000,
      saleRateUsdtPer1000: 5.3,
      purchaseRateUsdtPer1000: 4.7,
      rateBasis: "NET",
      robloxFeePct: 30,
      actualRevenueUsdt: 9,
    });
    expect(row.expectedRevenueUsdt).toBe(3.71);
    expect(row.revenueUsdt).toBe(9);
    expect(row.profitUsdt).toBe(4.3);
  });

  test("serializes the complete immutable ledger snapshot", () => {
    const row = computePartnerSettlement({
      grossRobux: 500,
      saleRateUsdtPer1000: 5.3,
      purchaseRateUsdtPer1000: 4.7,
      rateBasis: "NET",
      robloxFeePct: 30,
    });
    expect(settlementLedgerData(row)).toMatchObject({
      grossRobuxAmount: 500,
      netRobuxAmount: 350,
      costBasis: "RATE",
      rateBasis: "NET",
    });
  });

  test("rejects impossible policy values", () => {
    expect(partnerPolicyValid({ saleRateUsdtPer1000: 5.3, purchaseRateUsdtPer1000: 4.7, rateBasis: "NET", robloxFeePct: 100 })).toBe(false);
    expect(partnerNetRobux(1000, 100)).toBe(0);
  });
});
