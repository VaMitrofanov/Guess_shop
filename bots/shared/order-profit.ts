export interface OrderMoneySettings {
  purchaseRate?: number | null;
  usdToRub?: number | null;
}

export interface OrderMoneySource {
  saleAmountKopecks?: number | null;
}

export interface OrderProfitSnapshot {
  purchaseRate: number;
  purchaseRobuxAmount: number;
  purchaseRateUsdPer1k: number;
  purchaseUsdToRub: number;
  purchaseCostKopecks: number;
  profitKopecks?: number;
}

/** Immutable fulfillment snapshots shared by TWA and bot buyout paths. */
export function buildOrderProfitSnapshot(
  order: OrderMoneySource,
  settings: OrderMoneySettings,
  purchaseRobuxAmount: number,
): OrderProfitSnapshot | null {
  const rate = Number(settings.purchaseRate);
  const usdToRub = Number(settings.usdToRub);
  const robux = Math.round(Number(purchaseRobuxAmount));
  if (!(rate > 0) || !(usdToRub > 0) || !(robux > 0)) return null;

  const purchaseCostKopecks = Math.round((robux / 1000) * rate * usdToRub * 100);
  const snapshot: OrderProfitSnapshot = {
    purchaseRate: rate,
    purchaseRobuxAmount: robux,
    purchaseRateUsdPer1k: rate,
    purchaseUsdToRub: usdToRub,
    purchaseCostKopecks,
  };
  if (Number.isInteger(order.saleAmountKopecks) && Number(order.saleAmountKopecks) >= 0) {
    snapshot.profitKopecks = Number(order.saleAmountKopecks) - purchaseCostKopecks;
  }
  return snapshot;
}
