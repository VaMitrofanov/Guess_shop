import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canReceiveWbOrder } from "../../bots/shared/wb-delivery-policy";

const worker = readFileSync(resolve(__dirname, "../../bots/shared/wb-delivery-sync.ts"), "utf8");
const autoReceive = worker.slice(
  worker.indexOf("async function tryAutoReceive"),
  worker.indexOf("async function tryAutoGate"),
);

describe("automatic WB delivery close", () => {
  it("is off unless both its own flag and the mutations flag are set", () => {
    expect(autoReceive).toContain('process.env.WB_DBS_AUTO_RECEIVE !== "true"');
    expect(autoReceive).toContain('process.env.WB_DBS_MUTATIONS_ENABLED !== "true"');
  });

  /** WB's one-hour window is the only deadline here that cannot be recovered
   * from, so closing the delivery must not queue behind anything. Sending the
   * gate is retryable and stays visible via isWbBuyerUnserved. */
  it("closes the delivery before the gate is minted", () => {
    const capture = worker.slice(worker.indexOf("notifyDbsCodeCaptured(order.wbOrderId)"));
    const receive = capture.indexOf("tryAutoReceive(");
    const gate = capture.indexOf("tryAutoGate(");
    expect(receive).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(receive);
  });

  /** Closing the order sets completedAt, and the buyer still needs their code. */
  it("still sends the gate after the order has been closed", () => {
    const gate = worker.slice(worker.indexOf("async function tryAutoGate"));
    const guard = gate.slice(0, gate.indexOf("if (order.wbCode) return;"));
    expect(guard).toContain("order.cancelledAt");
    expect(guard).not.toContain("order.completedAt");
  });

  it("refuses to close without a live code from the buyer", () => {
    const base = {
      completedAt: null,
      cancelledAt: null,
      lastErrorCode: null,
      chatState: "CODE_RECEIVED",
      gateState: "NOT_ISSUED",
      supplierStatus: "deliver",
      denominationSnapshot: 300,
      hasLiveSecret: true,
    };
    // The gate does not gate this any more — the WB clock outranks it.
    expect(canReceiveWbOrder(base)).toBe(true);
    expect(canReceiveWbOrder({ ...base, hasLiveSecret: false })).toBe(false);
  });

  it("needs a live code and WB's own agreement that it is out for delivery", () => {
    const base = {
      completedAt: null,
      cancelledAt: null,
      lastErrorCode: null,
      chatState: "CODE_RECEIVED",
      gateState: "NOT_ISSUED",
      denominationSnapshot: 300,
      hasLiveSecret: true,
      supplierStatus: "deliver",
    };
    expect(canReceiveWbOrder({ ...base, hasLiveSecret: false })).toBe(false);
    expect(canReceiveWbOrder({ ...base, supplierStatus: "new" })).toBe(false);
    expect(canReceiveWbOrder({ ...base, completedAt: new Date() })).toBe(false);
    // Re-checked against the live API too, not just our cached status.
    expect(autoReceive).toContain("fetchDbsStatuses");
    expect(autoReceive).toContain('/deliver/i.test(status.supplierStatus');
  });

  /** A half-closed order the operator cannot see is worse than a failed one. */
  it("fails closed and tells the operator", () => {
    expect(autoReceive).toContain("AUTO_RECEIVE_FAILED");
    expect(autoReceive).toContain("AUTO_RECEIVE_OUTCOME_UNKNOWN");
    expect(autoReceive).toContain("notifyDbsAutoReceiveFailed");
    expect(autoReceive).not.toMatch(/retry|while\s*\(/i);
  });

  it("purges the buyer's code in the same transaction that closes the order", () => {
    const tx = autoReceive.slice(autoReceive.indexOf("db.$transaction"));
    expect(tx).toContain('completedAt: now');
    expect(tx).toContain('encryptedValue: "PURGED"');
  });
});
