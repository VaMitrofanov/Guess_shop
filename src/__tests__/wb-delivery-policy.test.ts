import {
  canCaptureDeliveryCode,
  canIssueWbGate,
  canReceiveWbOrder,
  isWbBuyerUnserved,
  shouldMarkCodeRequested,
  wbDeliverySecretIsLive,
  wbMarketplaceTerminalFlags,
  wbProductVendorCandidates,
  wbDeliveryStage,
  type WbDeliveryPolicyOrder,
} from "../../bots/shared/wb-delivery-policy";

function order(overrides: Partial<WbDeliveryPolicyOrder> = {}): WbDeliveryPolicyOrder {
  return {
    completedAt: null,
    cancelledAt: null,
    lastErrorCode: null,
    chatState: "READY",
    gateState: "NOT_ISSUED",
    supplierStatus: "new",
    denominationSnapshot: 500,
    hasLiveSecret: false,
    ...overrides,
  };
}

describe("WB DBS fail-closed policy", () => {
  it("derives deterministic catalog lookup keys without deriving a denomination", () => {
    expect(wbProductVendorCandidates("800/1")).toEqual(["800/1", "800"]);
    expect(wbProductVendorCandidates(" 800 ")).toEqual(["800"]);
    expect(wbProductVendorCandidates(undefined)).toEqual([]);
  });

  it("marks every completed-feed order terminal even when WB omits status fields", () => {
    expect(wbMarketplaceTerminalFlags(undefined, undefined, true)).toEqual({
      cancelled: false,
      completed: true,
    });
    expect(wbMarketplaceTerminalFlags("deliver", "waiting")).toEqual({
      cancelled: false,
      completed: false,
    });
  });

  it("does not issue a gate before an encrypted delivery code exists", () => {
    expect(canIssueWbGate(order({ chatState: "CODE_RECEIVED" }))).toBe(false);
    expect(canIssueWbGate(order({ chatState: "CODE_RECEIVED", hasLiveSecret: true }))).toBe(true);
  });

  it("only permits receive after link sent, deliver status and live secret", () => {
    const base = order({ chatState: "CODE_RECEIVED", gateState: "SENT", hasLiveSecret: true });
    expect(canReceiveWbOrder(base)).toBe(false);
    expect(canReceiveWbOrder({ ...base, supplierStatus: "deliver" })).toBe(true);
    expect(canReceiveWbOrder({ ...base, supplierStatus: "deliver", lastErrorCode: "OUTCOME_UNKNOWN" })).toBe(false);
  });

  it("treats consumed, purged and expired secrets as unusable", () => {
    const future = new Date(Date.now() + 60_000);
    expect(wbDeliverySecretIsLive({ encryptedValue: "v1:delivery-code:x", expiresAt: future })).toBe(true);
    expect(wbDeliverySecretIsLive({ encryptedValue: "PURGED", expiresAt: future })).toBe(false);
    expect(wbDeliverySecretIsLive({ encryptedValue: "v1:x", expiresAt: future, consumedAt: new Date() })).toBe(false);
    expect(wbDeliverySecretIsLive({ encryptedValue: "v1:x", expiresAt: new Date(Date.now() - 60_000) })).toBe(false);
    expect(wbDeliverySecretIsLive(null)).toBe(false);
  });

  /** Regression for 16.08.2026: the request was sent from the WB seller cabinet,
   * so `chatState` stayed READY and the buyer's code was detected but dropped. */
  it("captures a delivery code no matter which surface asked for it", () => {
    const active = { completedAt: null, cancelledAt: null };
    expect(canCaptureDeliveryCode(active, null)).toBe(true);
    expect(canCaptureDeliveryCode(active, { encryptedValue: "PURGED", expiresAt: new Date(Date.now() + 60_000) })).toBe(true);
    expect(canCaptureDeliveryCode(active, { encryptedValue: "v1:x", expiresAt: new Date(Date.now() + 60_000) })).toBe(false);
    expect(canCaptureDeliveryCode({ completedAt: new Date(), cancelledAt: null }, null)).toBe(false);
    expect(canCaptureDeliveryCode({ completedAt: null, cancelledAt: new Date() }, null)).toBe(false);
  });

  it("moves an untouched chat to waiting-for-code when the seller writes first", () => {
    expect(shouldMarkCodeRequested("READY")).toBe(true);
    expect(shouldMarkCodeRequested("WAITING_BUYER_CHAT")).toBe(true);
    expect(shouldMarkCodeRequested("CODE_REQUESTED")).toBe(false);
    expect(shouldMarkCodeRequested("CODE_RECEIVED")).toBe(false);
    expect(shouldMarkCodeRequested("REQUEST_SEND_UNKNOWN")).toBe(false);
  });

  /** Regression for 16.08.2026: WB order 5507223980 was closed from the seller
   * cabinet before the gate was issued. Completion settles the marketplace side
   * only — the buyer had paid and held nothing. */
  it("keeps the gate issuable when WB closed an order we never served", () => {
    const closedUnserved = order({
      completedAt: new Date(),
      supplierStatus: "receive",
      chatState: "CODE_RECEIVED",
      hasLiveSecret: true,
    });
    expect(isWbBuyerUnserved(closedUnserved)).toBe(true);
    expect(canIssueWbGate(closedUnserved)).toBe(true);
    expect(wbDeliveryStage(closedUnserved)).toBe("attention");
  });

  /** Regression: issuing the gate flipped gateState to ISSUED, which used to
   * clear the unserved flag and disable the very button that sends it — the
   * operator ended up holding a minted code with no way to deliver it. */
  it("stays unserved after the gate is minted but before it is sent", () => {
    const base = {
      completedAt: new Date(),
      supplierStatus: "receive",
      chatState: "CODE_RECEIVED" as const,
      hasLiveSecret: true,
    };
    for (const gateState of ["NOT_ISSUED", "ISSUED", "SENDING", "SEND_UNKNOWN"]) {
      expect(isWbBuyerUnserved(order({ ...base, gateState }))).toBe(true);
    }
    expect(isWbBuyerUnserved(order({ ...base, gateState: "SENT" }))).toBe(false);
  });

  it("treats a delivered gate as finished, however the order was closed", () => {
    const served = order({
      completedAt: new Date(),
      supplierStatus: "receive",
      chatState: "CODE_RECEIVED",
      gateState: "SENT",
      hasLiveSecret: false,
      internalStatus: "COMPLETED",
    });
    expect(isWbBuyerUnserved(served)).toBe(false);
    expect(canIssueWbGate(served)).toBe(false);
    expect(wbDeliveryStage(served)).toBe("complete");
  });

  /** Regression 17.08.2026: WB requires the seller to close the delivery, so
   * order 5508218105 was closed with no delivery code ever captured. Tying the
   * unserved flag to a live secret made the console call that buyer "served"
   * and refuse to mint their gate. */
  it("serves a buyer whose order closed without a delivery code", () => {
    const closedNoCode = order({
      completedAt: new Date(),
      supplierStatus: "receive",
      chatState: "CODE_REQUESTED",
      gateState: "NOT_ISSUED",
      hasLiveSecret: false,
    });
    expect(isWbBuyerUnserved(closedNoCode)).toBe(true);
    expect(canIssueWbGate(closedNoCode)).toBe(true);
    expect(wbDeliveryStage(closedNoCode)).toBe("attention");
  });

  /** Before the order closes the code is still the argument to our own receive
   * call, so it stays a precondition. */
  it("still requires the code while the order is open", () => {
    const open = order({ chatState: "CODE_REQUESTED", hasLiveSecret: false });
    expect(canIssueWbGate(open)).toBe(false);
    expect(canIssueWbGate(order({ chatState: "CODE_RECEIVED", hasLiveSecret: true }))).toBe(true);
  });

  /** Orders settled before this system existed must be closable without
   * pretending a code was minted, or they flag forever. */
  it("closes the obligation when an operator records an outside handover", () => {
    const settled = order({
      completedAt: new Date(),
      supplierStatus: "receive",
      gateState: "SERVED_EXTERNALLY",
    });
    expect(isWbBuyerUnserved(settled)).toBe(false);
    expect(canIssueWbGate(settled)).toBe(false);
    expect(wbDeliveryStage(settled)).toBe("complete");
  });

  /** The WB side can be closed while our own funnel is still running: the buyer
   * still has to activate the code, give a nick and confirm a game pass. */
  it("shows a delivered gate as in-bot until our own order finishes", () => {
    const sent = order({ completedAt: new Date(), supplierStatus: "receive", gateState: "SENT" });
    expect(wbDeliveryStage(sent)).toBe("in_bot");
    expect(wbDeliveryStage({ ...sent, internalStatus: "AWAITING_GAMEPASS" })).toBe("in_bot");
    expect(wbDeliveryStage({ ...sent, internalStatus: "PENDING" })).toBe("in_bot");
    expect(wbDeliveryStage({ ...sent, internalStatus: "COMPLETED" })).toBe("complete");
    expect(wbDeliveryStage({ ...sent, internalStatus: "REJECTED" })).toBe("complete");
    expect(isWbBuyerUnserved(sent)).toBe(false);
  });

  it("never mints a second gate for the same order", () => {
    for (const gateState of ["ISSUED", "SENDING", "SENT", "SEND_UNKNOWN"]) {
      expect(canIssueWbGate(order({ completedAt: new Date(), gateState }))).toBe(false);
    }
  });

  it("never revives a cancelled order", () => {
    const cancelled = order({
      completedAt: new Date(),
      cancelledAt: new Date(),
      chatState: "CODE_RECEIVED",
      hasLiveSecret: true,
    });
    expect(isWbBuyerUnserved(cancelled)).toBe(false);
    expect(canIssueWbGate(cancelled)).toBe(false);
    expect(wbDeliveryStage(cancelled)).toBe("cancelled");
  });

  it("still refuses receive on an order WB already closed", () => {
    expect(canReceiveWbOrder(order({
      completedAt: new Date(),
      supplierStatus: "deliver",
      gateState: "SENT",
      hasLiveSecret: true,
    }))).toBe(false);
  });

  it("prioritizes terminal and attention states", () => {
    // A completed order only reads as done once the gate actually went out;
    // closing the WB delivery is the seller's obligation, not proof of delivery.
    expect(wbDeliveryStage(order({ completedAt: new Date(), gateState: "SENT", internalStatus: "COMPLETED" }))).toBe("complete");
    // Gate out, buyer not through our funnel yet — work in progress, not done.
    expect(wbDeliveryStage(order({ completedAt: new Date(), gateState: "SENT" }))).toBe("in_bot");
    expect(wbDeliveryStage(order({ completedAt: new Date() }))).toBe("attention");
    expect(wbDeliveryStage(order({ cancelledAt: new Date() }))).toBe("cancelled");
    expect(wbDeliveryStage(order({ cancelledAt: new Date(), completedAt: new Date() }))).toBe("cancelled");
    expect(wbDeliveryStage(order({ lastErrorCode: "MISSING_DENOMINATION" }))).toBe("attention");
  });

  it("maps the normal operator progression", () => {
    expect(wbDeliveryStage(order())).toBe("chat_ready");
    expect(wbDeliveryStage(order({ chatState: "CODE_REQUESTED" }))).toBe("waiting_code");
    expect(wbDeliveryStage(order({ chatState: "CODE_RECEIVED", hasLiveSecret: true }))).toBe("code_received");
    expect(wbDeliveryStage(order({ chatState: "CODE_RECEIVED", hasLiveSecret: true, gateState: "ISSUED" }))).toBe("gate_ready");
    expect(wbDeliveryStage(order({ chatState: "CODE_RECEIVED", hasLiveSecret: true, gateState: "SENT", supplierStatus: "deliver" }))).toBe("ready_receive");
  });
});
