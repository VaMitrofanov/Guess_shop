import {
  canCaptureDeliveryCode,
  canIssueWbGate,
  canReceiveWbOrder,
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

  it("prioritizes terminal and attention states", () => {
    expect(wbDeliveryStage(order({ completedAt: new Date() }))).toBe("complete");
    expect(wbDeliveryStage(order({ cancelledAt: new Date() }))).toBe("cancelled");
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
