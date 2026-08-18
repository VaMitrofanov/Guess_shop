import {
  canCaptureDeliveryCode,
  canIssueWbGate,
  canReceiveWbOrder,
  isWbBuyerUnserved,
  shouldMarkCodeRequested,
  wbCancelledCodeAtRisk,
  wbDeliverySecretIsLive,
  wbFunnelStep,
  wbMarketplaceTerminalFlags,
  wbProductVendorCandidates,
  wbDeliveryStage,
  type WbDeliveryPolicyOrder,
} from "../../bots/shared/wb-delivery-policy";
import {
  WB_FUNNEL_LABEL,
  WB_QUEUE_SECTIONS,
  WB_STAGE_LABEL,
  WB_TERMINAL_STAGES,
  WB_URGENT_STAGES,
  wbAuditLabel,
} from "@/lib/wb-delivery-labels";

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

/** A buyer cancelling on WB gets their money back. Everything about that order
 * is dead weight in the console — except a code we already minted, which stays
 * redeemable and would hand out Robux for free. */
describe("WB DBS cancellations", () => {
  const cancelled = (overrides: Partial<WbDeliveryPolicyOrder> = {}) => order({
    cancelledAt: new Date(),
    supplierStatus: "cancel",
    ...overrides,
  });

  it("files away a cancellation that never got a code", () => {
    expect(wbCancelledCodeAtRisk(cancelled())).toBe(false);
    expect(wbDeliveryStage(cancelled())).toBe("cancelled");
  });

  it("keeps a cancellation whose minted code is still spendable", () => {
    for (const gateState of ["ISSUED", "SENDING", "SENT", "SEND_UNKNOWN"]) {
      expect(wbCancelledCodeAtRisk(cancelled({ gateState }))).toBe(true);
      expect(wbDeliveryStage(cancelled({ gateState }))).toBe("attention");
    }
  });

  it("lets go once our own funnel has finished either way", () => {
    for (const internalStatus of ["COMPLETED", "REJECTED"]) {
      expect(wbCancelledCodeAtRisk(cancelled({ gateState: "SENT", internalStatus }))).toBe(false);
      expect(wbDeliveryStage(cancelled({ gateState: "SENT", internalStatus }))).toBe("cancelled");
    }
  });

  it("still holds an order the buyer is actively walking through", () => {
    for (const internalStatus of ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS"]) {
      expect(wbCancelledCodeAtRisk(cancelled({ gateState: "SENT", internalStatus }))).toBe(true);
    }
  });

  it("never revives a cancelled order into an issuable one", () => {
    expect(canIssueWbGate(cancelled({ gateState: "ISSUED" }))).toBe(false);
    expect(canReceiveWbOrder(cancelled({ gateState: "SENT", hasLiveSecret: true, supplierStatus: "deliver" }))).toBe(false);
  });
});

/** «В нашем боте» covered five different situations that need different people.
 * The funnel step is what the console actually shows now. */
describe("WB DBS buyer funnel", () => {
  it("separates a buyer reading the instruction from one who gave a nick", () => {
    expect(wbFunnelStep(order({ internalStatus: "AWAITING_GAMEPASS" }))).toBe("instruction");
    expect(wbFunnelStep(order({ internalStatus: "AWAITING_GAMEPASS", internalRobloxUsername: "nick" }))).toBe("nick_given");
  });

  it("maps every internal status to a step an operator can act on", () => {
    expect(wbFunnelStep(order({ internalStatus: null }))).toBe("not_activated");
    expect(wbFunnelStep(order({ internalStatus: "PENDING" }))).toBe("ready_buyout");
    expect(wbFunnelStep(order({ internalStatus: "IN_PROGRESS" }))).toBe("buying");
    expect(wbFunnelStep(order({ internalStatus: "COMPLETED" }))).toBe("done");
    expect(wbFunnelStep(order({ internalStatus: "REJECTED" }))).toBe("rejected");
    expect(wbFunnelStep(order({ internalStatus: "ERROR" }))).toBe("failed");
  });

  it("labels every step it can produce", () => {
    const statuses = [null, "AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "COMPLETED", "REJECTED", "ERROR", "AWAITING_PAYMENT", "PAYMENT_PENDING"];
    for (const internalStatus of statuses) {
      expect(WB_FUNNEL_LABEL[wbFunnelStep(order({ internalStatus }))]).toBeTruthy();
    }
  });
});

/** The console filters on `stage` and nothing else. Mixing in raw timestamps is
 * what let an unserved buyer — money taken, nothing delivered — sit in the
 * «Готово» tab alongside genuinely finished orders. */
describe("WB DBS console vocabulary", () => {
  it("never files an unserved buyer as done", () => {
    const unserved = order({ completedAt: new Date(), supplierStatus: "receive" });
    expect(wbDeliveryStage(unserved)).toBe("attention");
    expect(WB_TERMINAL_STAGES).not.toContain(wbDeliveryStage(unserved));
    expect(WB_URGENT_STAGES).toContain(wbDeliveryStage(unserved));
  });

  it("keeps the urgent set disjoint from the terminal set", () => {
    for (const stage of WB_URGENT_STAGES) expect(WB_TERMINAL_STAGES).not.toContain(stage);
  });

  it("labels every stage the policy can return", () => {
    for (const stage of Object.keys(WB_STAGE_LABEL) as (keyof typeof WB_STAGE_LABEL)[]) {
      expect(WB_STAGE_LABEL[stage]).toBeTruthy();
    }
  });

  it("never shows a raw enum in the timeline", () => {
    expect(wbAuditLabel("GATE_CODE_ISSUED")).toBe("Выпущен код гейта");
    expect(wbAuditLabel("SOMETHING_NEW_ENTIRELY")).not.toMatch(/_/);
  });

  /** A stage missing from the grouping would disappear from «В работе»
   * entirely: the tab renders sections, not the flat list. */
  it("routes every working stage into exactly one section", () => {
    const working = (Object.keys(WB_STAGE_LABEL) as (keyof typeof WB_STAGE_LABEL)[])
      .filter((stage) => !WB_TERMINAL_STAGES.includes(stage));
    const sectioned = WB_QUEUE_SECTIONS.flatMap((section) => [...section.stages]);
    expect([...sectioned].sort()).toEqual([...working].sort());
    expect(new Set(sectioned).size).toBe(sectioned.length);
  });
});
