import {
  computePartnerSettlement,
  partnerNetRobux,
  partnerPolicyValid,
  settlementLedgerData,
} from "@/lib/partner-economics";

describe("partner economics", () => {
  test("charges Anton for net Robux while supplier cost stays gross", () => {
    const row = computePartnerSettlement({
      grossRobux: 1429,
      saleRateUsdtPer1000: 5.3,
      purchaseRateUsdtPer1000: 4.7,
      rateBasis: "NET",
      robloxFeePct: 30,
    });

    expect(row.netRobux).toBe(1000);
    expect(row.expectedRevenueUsdt).toBe(5.3);
    expect(row.costUsdt).toBe(6.72);
    expect(row.profitUsdt).toBe(-1.42);
    expect(row.marginPct).toBe(-26.79);
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
