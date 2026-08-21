import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canReceiveWbOrder,
  canSendWbGate,
  wbAutoReceiveWithinWindow,
  wbOrderAgeHours,
  wbOrderPlacedAt,
  wbReceiveRetryCutoff,
  WB_AUTO_RECEIVE_ORDER_AGE_MS,
  WB_RECEIVE_MAX_ATTEMPTS,
  WB_RECEIVE_RETRY_INTERVAL_MS,
} from "../../bots/shared/wb-delivery-policy";

const worker = readFileSync(resolve(__dirname, "../../bots/shared/wb-delivery-sync.ts"), "utf8");
const autoReceive = worker.slice(
  worker.indexOf("async function tryAutoReceive"),
  worker.indexOf("async function askBuyerForAnotherCode"),
);
const retrySweep = worker.slice(
  worker.indexOf("async function retryAutoReceive"),
  worker.indexOf("async function dispatchGatesForClosedOrders"),
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
   * from, so closing the delivery must not queue behind anything. */
  it("closes the delivery before the gate is minted", () => {
    const capture = worker.slice(worker.indexOf("async function captureDeliveryCode"));
    const receive = capture.indexOf("await tryAutoReceive(");
    const gate = capture.indexOf("await tryAutoGate(");
    expect(receive).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(receive);
  });

  /** 20.08, заказ 5540950769: покупатель прислал код, WB отклонил его — и через
   * секунду покупатель получил «Заказ подтверждён» со ссылкой на получение.
   * Гейт обязан ждать закрытия доставки, иначе случайный набор цифр в чате
   * открывает выдачу. */
  it("hands out the gate only once the delivery is actually closed", () => {
    const capture = worker.slice(worker.indexOf("async function captureDeliveryCode"));
    // Не «не упало», а «закрыто»: исход попытки теперь возвращается явно.
    expect(capture).toContain("const { closed, skip } = await tryAutoReceive(");
    expect(capture).toContain("if (closed) await tryAutoGate(");
    // И сама отправка проверяет это ещё раз — её зовёт не только захват кода.
    const gate = worker.slice(worker.indexOf("async function tryAutoGate"));
    const guard = gate.slice(0, gate.indexOf("if (order.wbCode) return;"));
    expect(guard).toContain("if (!canSendWbGate(order)) return;");
    expect(canSendWbGate({ completedAt: null, cancelledAt: null })).toBe(false);
    expect(canSendWbGate({ completedAt: new Date(), cancelledAt: null })).toBe(true);
    // Тестовый заказ не ходит в WB вообще — иначе демо-прогон невозможен.
    expect(canSendWbGate({ completedAt: null, cancelledAt: null, isTest: true })).toBe(true);
    // Отменённый заказ не выдаётся никогда: деньги вернулись покупателю.
    expect(canSendWbGate({ completedAt: new Date(), cancelledAt: new Date() })).toBe(false);
  });

  /** Закрытие может случиться позже прихода кода — WB лагает, или оператор
   * закрывает заказ руками в кабинете. Покупателю всё равно нужно выдать код,
   * и делать это должен воркер, а не человек. */
  it("comes back for orders closed after the code arrived", () => {
    const sweep = worker.slice(
      worker.indexOf("async function dispatchGatesForClosedOrders"),
      worker.indexOf("/** Walks DBS orders through WB's own"),
    );
    expect(sweep).toContain('process.env.WB_DBS_AUTO_GATE !== "true"');
    expect(sweep).toContain('process.env.WB_CHAT_SEND_ENABLED !== "true"');
    expect(sweep).toContain('gateState: "NOT_ISSUED"');
    expect(sweep).toContain("completedAt: { gte:");
    expect(sweep).toContain("tryAutoGate(");
    // В цикле — строго после закрытия доставки.
    const cycle = worker.slice(worker.indexOf("export async function runWbDeliverySync"));
    expect(cycle).toContain('await step("auto-gate", () => dispatchGatesForClosedOrders(db))');
    expect(cycle.indexOf('await step("auto-gate"')).toBeGreaterThan(cycle.indexOf('await step("auto-receive"'));
  });

  /** Бюджет попыток сгорал за десять секунд — цикл идёт раз в 5 с, — а тот
   * самый код 20.08 прошёл позже. Верный код обязан пережить лаг WB. */
  it("spaces the retries out instead of burning them in ten seconds", () => {
    expect(WB_RECEIVE_RETRY_INTERVAL_MS).toBeGreaterThanOrEqual(60_000);
    expect(WB_RECEIVE_MAX_ATTEMPTS * WB_RECEIVE_RETRY_INTERVAL_MS).toBeGreaterThanOrEqual(5 * 60_000);
    // ...и остаётся внутри часового окна WB.
    expect(WB_RECEIVE_MAX_ATTEMPTS * WB_RECEIVE_RETRY_INTERVAL_MS).toBeLessThan(60 * 60_000);
    expect(retrySweep).toContain("updatedAt: { lt: wbReceiveRetryCutoff() }");
    // Секрет, тронутый только что, в выборку не попадает; тронутый минуту назад — попадает.
    const now = new Date("2026-08-21T10:00:00Z");
    expect(wbReceiveRetryCutoff(now).getTime()).toBe(now.getTime() - WB_RECEIVE_RETRY_INTERVAL_MS);
    expect(wbReceiveRetryCutoff(now).getTime()).toBeLessThan(now.getTime());
  });

  /** Все попытки исчерпаны, а отказ был внятным — значит код не тот. Просим у
   * покупателя новый вместо молчания, и освобождаем место под него: живой
   * секрет не даёт `canCaptureDeliveryCode` сохранить следующий код. */
  it("asks the buyer for another code instead of leaving them with nothing", () => {
    const ask = worker.slice(
      worker.indexOf("async function askBuyerForAnotherCode"),
      worker.indexOf("/** Closing the delivery used to get exactly one attempt"),
    );
    expect(autoReceive).toContain("askBuyerForAnotherCode(db, orderId, wbOrderId)");
    // Только на внятный отказ: на «исход неизвестен» покупателю не пишут.
    expect(autoReceive).toContain("if (exhausted && !unknown)");
    expect(autoReceive).toContain("const exhausted = attempt >= WB_RECEIVE_MAX_ATTEMPTS;");
    // И оператора не будят на каждой из восьми попыток — только первая и последняя.
    expect(autoReceive).toContain("} else if (attempt <= 1 || exhausted) {");
    // CAS решает, кто пишет покупателю — дубля просьбы быть не может.
    expect(ask).toContain('chatState: "CODE_RECEIVED"');
    expect(ask).toContain('chatState: "CODE_REQUESTED", lastErrorCode: "DELIVERY_CODE_REJECTED"');
    expect(ask).toContain('encryptedValue: "PURGED"');
    expect(ask).toContain("wbCodeRetryMessage()");
    expect(ask).toContain("MAX_CODE_RETRY_REQUESTS");
    expect(ask).toContain("notifyDbsCodeRejected");
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
    for (const reason of ["flag_off", "no_secret", "already_closed", "too_many_attempts", "wb_not_in_delivery", "order_too_old"]) {
      expect(autoReceive).toContain(`"${reason}"`);
    }
    expect(worker).toContain("notifyDbsCodeCaptured(order.wbOrderId, skip");
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

/** Решение владельца 21.08.2026. Заказ 5508870842 пролежал без кода пять дней,
 * покупатель в это время жаловался в чат — и код, присланный на пятый день,
 * закрыл бы доставку так же молча и мгновенно, как код на первой минуте.
 * Внутри четырёх часов это правильное поведение; дальше решает человек. */
describe("four-hour auto-close window", () => {
  const HOUR = 60 * 60_000;
  const placed = new Date("2026-08-16T12:00:00Z");

  it("is four hours from when the order was placed", () => {
    expect(WB_AUTO_RECEIVE_ORDER_AGE_MS).toBe(4 * HOUR);
  });

  it("closes on codes that arrive inside the window", () => {
    const order = { wbCreatedAt: placed, firstSeenAt: placed };
    expect(wbAutoReceiveWithinWindow(order, placed)).toBe(true);
    expect(wbAutoReceiveWithinWindow(order, new Date(placed.getTime() + 3.9 * HOUR))).toBe(true);
    expect(wbAutoReceiveWithinWindow(order, new Date(placed.getTime() + 4 * HOUR))).toBe(true);
  });

  it("hands the decision to a person once the window has passed", () => {
    const order = { wbCreatedAt: placed, firstSeenAt: placed };
    expect(wbAutoReceiveWithinWindow(order, new Date(placed.getTime() + 4 * HOUR + 1))).toBe(false);
    expect(wbAutoReceiveWithinWindow(order, new Date(placed.getTime() + 5 * 24 * HOUR))).toBe(false);
  });

  /** Окно считается от прихода кода, а не от «сейчас»: код, принятый на третьем
   * часу, обязан пережить лаг WB и восемь минут ретраев, а не быть брошенным на
   * четвёртом часу посреди уже начатого закрытия. */
  it("lets a code accepted inside the window finish its retries afterwards", () => {
    const order = { wbCreatedAt: placed, firstSeenAt: placed };
    const received = new Date(placed.getTime() + 3.99 * HOUR);
    expect(wbAutoReceiveWithinWindow(order, received)).toBe(true);
  });

  /** `firstSeenAt` — это когда заказ увидел воркер. После простоя воркера он
   * показал бы многодневный заказ свежим, поэтому слово WB главнее. */
  it("prefers WB's own creation time over when the worker noticed the order", () => {
    const noticedLate = { wbCreatedAt: placed, firstSeenAt: new Date(placed.getTime() + 20 * HOUR) };
    expect(wbOrderPlacedAt(noticedLate)).toEqual(placed);
    expect(wbAutoReceiveWithinWindow(noticedLate, new Date(placed.getTime() + 20 * HOUR))).toBe(false);
    // Заказы, заведённые до появления колонки, считаются от `firstSeenAt`.
    expect(wbOrderPlacedAt({ wbCreatedAt: null, firstSeenAt: placed })).toEqual(placed);
  });

  it("reports the order's age for the operator's message", () => {
    const order = { wbCreatedAt: placed, firstSeenAt: placed };
    expect(wbOrderAgeHours(order, new Date(placed.getTime() + 5 * HOUR))).toBe(5);
    expect(wbOrderAgeHours(order, placed)).toBe(0);
  });

  it("is wired into the closing attempt, ahead of any call to WB", () => {
    expect(autoReceive).toContain("wbAutoReceiveWithinWindow(order, order.deliverySecret.receivedAt)");
    expect(autoReceive.indexOf("wbAutoReceiveWithinWindow")).toBeLessThan(autoReceive.indexOf("receiveDbsOrder"));
  });

  /** Уведомление без кода бесполезно: закрыть доставку в кабинете WB оператор
   * может только кодом покупателя, а в чате WB он замаскирован. */
  it("puts the delivery code itself in the operator's message", () => {
    const capture = worker.slice(
      worker.indexOf("async function captureDeliveryCode"),
      worker.indexOf("async function backfillDeliveryCodes"),
    );
    expect(capture).toContain('skip === "order_too_old"');
    expect(capture).toContain("deliveryCode: code");
    expect(capture).toContain("ageHours: wbOrderAgeHours(order, receivedAt)");
  });

  /** Придержанный заказ не «застрял» — он ждёт человека по правилу, и второе
   * сообщение, толкающее закрыть доставку, противоречило бы первому. */
  it("does not also shout that the delivery is stuck", () => {
    const stuck = worker.slice(
      worker.indexOf("async function alertStuckDeliveries"),
      worker.indexOf("async function tryAutoGate"),
    );
    expect(stuck).toContain("if (receivedAt && !wbAutoReceiveWithinWindow(order, receivedAt)) continue;");
  });
});
