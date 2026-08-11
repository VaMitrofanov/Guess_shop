export type WbDeliveryStage =
  | "attention"
  | "new"
  | "chat_ready"
  | "waiting_code"
  | "code_received"
  | "gate_ready"
  | "link_sent"
  | "ready_receive"
  | "complete"
  | "cancelled";

export type WbDeliveryPolicyOrder = {
  completedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
  lastErrorCode?: string | null;
  chatState: string;
  gateState: string;
  supplierStatus: string;
  denominationSnapshot?: number | null;
  hasLiveSecret?: boolean;
};

export function wbMarketplaceTerminalFlags(
  supplierStatus: string | undefined,
  wbStatus: string | undefined,
  fromCompletedFeed = false,
) {
  const combined = `${supplierStatus ?? ""} ${wbStatus ?? ""}`;
  return {
    cancelled: /cancel|reject/i.test(combined),
    completed: fromCompletedFeed || /sold|receive|complete/i.test(combined),
  };
}

/** WB can publish a replacement nmId while keeping a catalog vendor code such
 * as `800/1`. Candidates are lookup keys only; denomination is still read from
 * the trusted WbProductCost row. */
export function wbProductVendorCandidates(article: string | undefined) {
  const exact = article?.trim();
  if (!exact) return [];
  const base = exact.split("/", 1)[0]?.trim();
  return [...new Set([exact, base].filter((value): value is string => Boolean(value)))];
}

export function wbDeliveryStage(order: WbDeliveryPolicyOrder): WbDeliveryStage {
  if (order.cancelledAt) return "cancelled";
  if (order.completedAt || /sold|receive|complete/i.test(order.supplierStatus)) return "complete";
  if (order.lastErrorCode) return "attention";
  if (
    order.gateState === "SENT" &&
    order.hasLiveSecret &&
    /deliver/i.test(order.supplierStatus)
  ) return "ready_receive";
  if (order.gateState === "SENT") return "link_sent";
  if (order.gateState === "ISSUED") return "gate_ready";
  if (order.chatState === "CODE_RECEIVED") return "code_received";
  if (order.chatState === "CODE_REQUESTED" || order.chatState === "REQUEST_SEND_UNKNOWN") return "waiting_code";
  if (order.chatState === "READY") return "chat_ready";
  return "new";
}

export function canIssueWbGate(order: WbDeliveryPolicyOrder): boolean {
  return Boolean(
    !order.completedAt &&
    !order.cancelledAt &&
    !order.lastErrorCode &&
    order.chatState === "CODE_RECEIVED" &&
    order.denominationSnapshot &&
    order.gateState === "NOT_ISSUED" &&
    order.hasLiveSecret,
  );
}

export function canReceiveWbOrder(order: WbDeliveryPolicyOrder): boolean {
  return Boolean(
    !order.completedAt &&
    !order.cancelledAt &&
    !order.lastErrorCode &&
    order.gateState === "SENT" &&
    order.hasLiveSecret &&
    /deliver/i.test(order.supplierStatus),
  );
}
