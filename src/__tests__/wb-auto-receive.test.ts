import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canReceiveWbOrder } from "../../bots/shared/wb-delivery-policy";

const worker = readFileSync(resolve(__dirname, "../../bots/shared/wb-delivery-sync.ts"), "utf8");
const autoReceive = worker.slice(
  worker.indexOf("async function tryAutoReceive"),
  worker.indexOf("async function retryAutoReceive"),
);
const retrySweep = worker.slice(
  worker.indexOf("async function retryAutoReceive"),
  worker.indexOf("async function tryAutoShip"),
);
const autoShip = worker.slice(
  worker.indexOf("async function tryAutoShip"),
  worker.indexOf("async function alertStuckDeliveries"),
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
    const capture = worker.slice(worker.indexOf("async function captureDeliveryCode"));
    const receive = capture.indexOf("await tryAutoReceive(");
    const gate = capture.indexOf("await tryAutoGate(");
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
    // No loop inside a single attempt: bounded repetition is the sweep's job.
    expect(autoReceive).not.toMatch(/while\s*\(|for\s*\(/);
  });

  /** F1: the attempt used to be one-shot, taken at the instant the code landed.
   * If the order had not reached `deliver` yet — the normal case once the
   * auto-reply cut buyer response time to minutes — that single chance was
   * spent and never retried. */
  it("retries on every cycle instead of getting one shot at capture time", () => {
    expect(retrySweep).toContain("tryAutoReceive(");
    expect(retrySweep).toContain("consumedAt: null");
    expect(retrySweep).toContain("WB_RECEIVE_MAX_ATTEMPTS");
    // Wired into the cycle, not just defined.
    expect(worker).toContain('await step("auto-receive", () => retryAutoReceive(db))');
  });

  /** Every skip used to be a bare `return`: no audit row, no message, and from
   * the outside indistinguishable from a notification that never arrived. */
  it("names the reason it skipped instead of returning silently", () => {
    for (const reason of ["flag_off", "no_secret", "already_closed", "too_many_attempts", "wb_not_in_delivery"]) {
      expect(autoReceive).toContain(`"${reason}"`);
    }
    expect(worker).toContain("if (skip) notifyDbsCodeCaptured(order.wbOrderId, skip)");
  });

  /** Nothing walked a DBS order along WB's own ladder, so closing only worked
   * when a human had pushed it through the seller cabinet first. */
  it("moves the order to `deliver` itself, behind its own flag", () => {
    expect(autoShip).toContain('process.env.WB_DBS_AUTO_SHIP !== "true"');
    expect(autoShip).toContain('process.env.WB_DBS_MUTATIONS_ENABLED !== "true"');
    expect(autoShip).toContain("confirmDbsOrder");
    expect(autoShip).toContain("deliverDbsOrder");
    expect(autoShip).toContain("wbAutoShipAction");
    // Never touches an order that is already settled one way or another.
    expect(autoShip).toContain("completedAt: null");
    expect(autoShip).toContain("cancelledAt: null");
    // Runs before the retry sweep: an order already in `deliver` is one the
    // buyer's code can close on arrival.
    const cycle = worker.slice(worker.indexOf("export async function runWbDeliverySync"));
    expect(cycle.indexOf('await step("auto-ship"')).toBeLessThan(cycle.indexOf('await step("auto-receive"'));
  });

  /** WB — это два независимых сервиса, и 20.08 лёг только чат: 500 на
   * `/seller/chats`, 504 на `/seller/events`, при этом marketplace отвечал 200.
   * Цикл был «всё или ничего», поэтому вместе с чатом переставали работать и
   * опрос статусов, и автоперевод в доставку, и автозакрытие — то есть падение
   * необязательного сервиса съедало единственный дедлайн, который не отыграть. */
  it("keeps closing deliveries when WB's chat service is down", () => {
    const cycle = worker.slice(worker.indexOf("export async function runWbDeliverySync"));
    // Каждый шаг изолирован общим хелпером, а не голым await.
    expect(cycle).toContain('await step("chat-events"');
    expect(cycle).toContain('await step("auto-ship"');
    expect(cycle).toContain('await step("auto-receive"');
    // Обязательства перед WB идут после чата — и обязаны выполняться, даже
    // когда чат уже упал.
    expect(cycle.indexOf('await step("auto-ship"')).toBeGreaterThan(cycle.indexOf('await step("chat-events"'));
    // Частичный отказ виден: «здоров» ставится только когда не упало ничего.
    expect(cycle).toContain("failures.length ? `DEGRADED:");
  });

  it("purges the buyer's code in the same transaction that closes the order", () => {
    const tx = autoReceive.slice(autoReceive.indexOf("db.$transaction"));
    expect(tx).toContain('completedAt: now');
    expect(tx).toContain('encryptedValue: "PURGED"');
  });
});
