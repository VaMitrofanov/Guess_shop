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
  // Closed at WB but never handed the buyer a gate — the loudest state we have,
  // because the money is settled and the customer is still empty-handed.
  if (isWbBuyerUnserved(order)) return "attention";
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

export type WbDeliverySecretState = {
  consumedAt?: Date | null;
  encryptedValue: string;
  expiresAt: Date;
} | null | undefined;

/** A secret is usable only while it is unconsumed, unpurged and inside its TTL.
 * Every surface must agree on this or the console offers actions WB will reject. */
export function wbDeliverySecretIsLive(secret: WbDeliverySecretState, now = new Date()): boolean {
  return Boolean(
    secret &&
    !secret.consumedAt &&
    secret.encryptedValue !== "PURGED" &&
    secret.expiresAt.getTime() > now.getTime(),
  );
}

/** Capture must not depend on `chatState`: the operator may have asked for the
 * code straight from the WB seller cabinet, which never touches our state
 * machine. The only real guards are a closed order and a still-usable secret. */
export function canCaptureDeliveryCode(
  order: Pick<WbDeliveryPolicyOrder, "completedAt" | "cancelledAt">,
  secret: WbDeliverySecretState,
  now = new Date(),
): boolean {
  if (order.completedAt || order.cancelledAt) return false;
  return !wbDeliverySecretIsLive(secret, now);
}

/** Any outbound message means the conversation has started, so the console must
 * stop presenting "send the instruction" as the next step. */
export function shouldMarkCodeRequested(chatState: string): boolean {
  return chatState === "WAITING_BUYER_CHAT" || chatState === "READY";
}

/** A WB order can reach `receive/sold` without us: the operator can close it
 * from the seller cabinet. That settles the marketplace transaction, never our
 * obligation to hand over the Robux, so a closed order whose gate was never
 * issued is an unserved buyer, not a finished one.
 *
 * `hasLiveSecret` is what separates the two. Our own `receive` purges the
 * secret on success, so an order we completed can never match; only one closed
 * behind our back still carries a usable code. */
export function isWbBuyerUnserved(order: WbDeliveryPolicyOrder): boolean {
  return Boolean(
    order.completedAt &&
    !order.cancelledAt &&
    order.gateState === "NOT_ISSUED" &&
    order.hasLiveSecret,
  );
}

export function canIssueWbGate(order: WbDeliveryPolicyOrder): boolean {
  return Boolean(
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
