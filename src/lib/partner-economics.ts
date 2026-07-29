export type PartnerRateBasisValue = "DIRTY" | "NET";
export type PartnerCostBasisValue = "ASSUMED" | "RATE" | "ACTUAL" | "MANUAL";

export type PartnerEconomicPolicy = {
  saleRateUsdtPer1000: number;
  purchaseRateUsdtPer1000: number;
  rateBasis: PartnerRateBasisValue;
  robloxFeePct: number;
};

export type PartnerSettlement = PartnerEconomicPolicy & {
  grossRobux: number;
  netRobux: number;
  billedRobux: number;
  expectedRevenueUsdt: number;
  revenueUsdt: number;
  costUsdt: number;
  profitUsdt: number;
  marginPct: number | null;
};

export function roundPartnerMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function partnerNetRobux(grossRobux: number, robloxFeePct: number) {
  if (!Number.isFinite(grossRobux) || grossRobux <= 0) return 0;
  if (!Number.isFinite(robloxFeePct) || robloxFeePct < 0 || robloxFeePct >= 100) return 0;
  return Math.floor(grossRobux * (1 - robloxFeePct / 100));
}

export function partnerPolicyValid(policy: PartnerEconomicPolicy) {
  return Number.isFinite(policy.saleRateUsdtPer1000) && policy.saleRateUsdtPer1000 > 0
    && Number.isFinite(policy.purchaseRateUsdtPer1000) && policy.purchaseRateUsdtPer1000 > 0
    && (policy.rateBasis === "DIRTY" || policy.rateBasis === "NET")
    && Number.isFinite(policy.robloxFeePct) && policy.robloxFeePct >= 0 && policy.robloxFeePct < 100;
}

/**
 * One immutable partner settlement.
 *
 * Anton's current contract is NET: he pays for the Robux that reach the seller,
 * while our supplier charges for the gross Robux spent by the donor. Historical
 * rows can stay DIRTY so the accounting snapshot describes what the old code
 * actually charged instead of silently rewriting the partner balance.
 */
export function computePartnerSettlement(input: PartnerEconomicPolicy & {
  grossRobux: number;
  actualRevenueUsdt?: number;
}): PartnerSettlement {
  if (!partnerPolicyValid(input)) throw new Error("Invalid partner economic policy");
  if (!Number.isFinite(input.grossRobux) || input.grossRobux <= 0) {
    throw new Error("grossRobux must be greater than zero");
  }

  const grossRobux = Math.round(input.grossRobux);
  const netRobux = partnerNetRobux(grossRobux, input.robloxFeePct);
  const billedRobux = input.rateBasis === "NET" ? netRobux : grossRobux;
  const expectedRevenueUsdt = roundPartnerMoney(billedRobux * input.saleRateUsdtPer1000 / 1000);
  const revenueUsdt = input.actualRevenueUsdt === undefined
    ? expectedRevenueUsdt
    : roundPartnerMoney(input.actualRevenueUsdt);
  const costUsdt = roundPartnerMoney(grossRobux * input.purchaseRateUsdtPer1000 / 1000);
  const profitUsdt = roundPartnerMoney(revenueUsdt - costUsdt);
  const marginPct = revenueUsdt === 0 ? null : Math.round((profitUsdt / revenueUsdt) * 10_000) / 100;

  return {
    saleRateUsdtPer1000: input.saleRateUsdtPer1000,
    purchaseRateUsdtPer1000: input.purchaseRateUsdtPer1000,
    rateBasis: input.rateBasis,
    robloxFeePct: input.robloxFeePct,
    grossRobux,
    netRobux,
    billedRobux,
    expectedRevenueUsdt,
    revenueUsdt,
    costUsdt,
    profitUsdt,
    marginPct,
  };
}

export function partnerPolicyFrom(input: {
  robuxRateUsdtPer1000: number;
  purchaseRateUsdtPer1000: number;
  rateBasis: PartnerRateBasisValue;
  robloxFeePct: number;
}): PartnerEconomicPolicy {
  return {
    saleRateUsdtPer1000: input.robuxRateUsdtPer1000,
    purchaseRateUsdtPer1000: input.purchaseRateUsdtPer1000,
    rateBasis: input.rateBasis,
    robloxFeePct: input.robloxFeePct,
  };
}

export function settlementLedgerData(
  settlement: PartnerSettlement,
  costBasis: PartnerCostBasisValue = "RATE",
) {
  return {
    rateUsdtPer1000: settlement.saleRateUsdtPer1000,
    purchaseRateUsdtPer1000: settlement.purchaseRateUsdtPer1000,
    rateBasis: settlement.rateBasis,
    costBasis,
    robloxFeePct: settlement.robloxFeePct,
    robuxAmount: settlement.grossRobux,
    grossRobuxAmount: settlement.grossRobux,
    netRobuxAmount: settlement.netRobux,
    revenueUsdt: settlement.revenueUsdt,
    expectedRevenueUsdt: settlement.expectedRevenueUsdt,
    costUsdt: settlement.costUsdt,
    profitUsdt: settlement.profitUsdt,
  } as const;
}
