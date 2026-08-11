import {
  canIssueWbGate,
  canReceiveWbOrder,
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
