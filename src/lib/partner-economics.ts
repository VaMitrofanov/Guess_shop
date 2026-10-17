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

export type PartnerTaskEconomicSnapshot = PartnerSettlement & {
  costBasis: PartnerCostBasisValue | null;
  snapshotSource: "task" | "batch";
};

export type PartnerLedgerEconomicSource = {
  taskId?: string | null;
  rateUsdtPer1000?: number | null;
  purchaseRateUsdtPer1000?: number | null;
  rateBasis?: PartnerRateBasisValue | null;
  costBasis?: PartnerCostBasisValue | null;
  robloxFeePct?: number | null;
  revenueUsdt?: number | null;
};

// Google Sheets keeps the partner balance below one cent. With a rate stored to
// four decimals and an integer R$ amount, C * F / 1000 needs up to 7 decimals.
export function roundPartnerMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000_000) / 10_000_000;
}

/**
 * Google Sheets may pin a sale rate for one partner order. Keep the parser
 * shared by the API and both admin clients so previews and the final ledger
 * debit cannot silently use different rates.
 */
export function partnerOrderRateUsdtPer1000(
  sheetRaw: unknown,
  fallbackRate: number,
) {
  if (sheetRaw && typeof sheetRaw === "object" && !Array.isArray(sheetRaw)) {
    const value = Number((sheetRaw as Record<string, unknown>).sheetRateUsdtPer1000);
    if (Number.isFinite(value) && value > 0 && value <= 1000) return value;
  }
  return fallbackRate;
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
 * The policy explicitly selects gross (DIRTY) or net (NET) billing. Historical
 * rows keep their original basis so the accounting snapshot is never silently
 * rewritten when the current partner policy changes.
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

/**
 * Reconstruct one task's historical economics from its immutable ledger row.
 * Legacy browser batches have no taskId and contain a batch total, so their
 * revenue is recomputed for the task while keeping the batch's pinned policy.
 */
export function partnerTaskEconomicSnapshot(
  grossRobux: number,
  source: PartnerLedgerEconomicSource,
  fallbackFeePct: number,
): PartnerTaskEconomicSnapshot | null {
  const saleRate = Number(source.rateUsdtPer1000);
  const purchaseRate = Number(source.purchaseRateUsdtPer1000);
  const feePct = Number(source.robloxFeePct ?? fallbackFeePct);
  const rateBasis = source.rateBasis ?? "DIRTY";
  if (!Number.isFinite(saleRate) || saleRate <= 0
    || !Number.isFinite(purchaseRate) || purchaseRate <= 0
    || !Number.isFinite(feePct) || feePct < 0 || feePct >= 100
    || (rateBasis !== "DIRTY" && rateBasis !== "NET")) {
    return null;
  }

  const taskScopedRevenue = source.taskId && Number.isFinite(Number(source.revenueUsdt))
    ? Number(source.revenueUsdt)
    : undefined;
  const settlement = computePartnerSettlement({
    grossRobux,
    saleRateUsdtPer1000: saleRate,
    purchaseRateUsdtPer1000: purchaseRate,
    rateBasis,
    robloxFeePct: feePct,
    actualRevenueUsdt: taskScopedRevenue,
  });

  return {
    ...settlement,
    costBasis: source.costBasis ?? null,
    snapshotSource: source.taskId ? "task" : "batch",
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
