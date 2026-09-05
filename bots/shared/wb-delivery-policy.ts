export type WbDeliveryStage =
  | "attention"
  | "new"
  | "chat_ready"
  | "waiting_code"
  | "code_received"
  | "gate_ready"
  | "link_sent"
  | "ready_receive"
  /** Code delivered, buyer now working through our own bot: activating it,
   * reading the instruction, giving a Roblox nick, confirming a game pass. */
  | "in_bot"
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
  /** `WbOrder.status` for the code we issued, or null while the buyer has not
   * activated it yet. Only meaningful once the gate has gone out. */
  internalStatus?: string | null;
  /** Roblox nick on the internal order. Separates "still reading the
   * instruction" from "told us who to deliver to" inside the same status. */
  internalRobloxUsername?: string | null;
  /** How many times WB has already rejected this delivery code. Bounds the
   * automatic retry without permanently disabling it the way `lastErrorCode`
   * did. */
  secretFailedAttempts?: number | null;
};

/** Where the buyer actually stands inside our own funnel once the gate is out.
 * `in_bot` on its own is too coarse to act on: an order waiting for a nick and
 * an order waiting for Robux need different people. */
export type WbFunnelStep =
  | "not_activated"
  | "instruction"
  | "nick_given"
  | "ready_buyout"
  | "buying"
  | "done"
  | "rejected"
  | "failed"
  | "awaiting_payment";

/** Gate states where a redeemable code exists in the wild. */
const GATE_MINTED = new Set(["ISSUED", "SENDING", "SENT", "SEND_UNKNOWN"]);

/** Internal statuses that mean our funnel is over, one way or another. */
const FUNNEL_FINISHED = new Set(["COMPLETED", "REJECTED"]);

/** Internal statuses where a WB cancellation can be mirrored automatically:
 * nothing has been bought yet, so closing the order costs nobody anything.
 *
 * `IN_PROGRESS` and `ERROR` are deliberately absent — a purchase may already be
 * in flight or half-done, and robux we have actually spent is a decision for a
 * person. Those stay in the console as `attention` instead. */
const INTERNAL_SAFE_TO_REJECT = new Set([
  "AWAITING_GAMEPASS",
  "PENDING",
  "AWAITING_PAYMENT",
  "PAYMENT_PENDING",
]);

export function canAutoRejectInternalOrder(internalStatus: string | null | undefined): boolean {
  return INTERNAL_SAFE_TO_REJECT.has(internalStatus ?? "");
}

/** Whether an operator may open a buyout order for this DBS order by hand.
 *
 * The gate code is the join key — `WbOrder.wbCode` is unique and every corridor
 * surface looks the order up by it — so a gate that was never minted has
 * nothing to hang a buyout on, and one that already has an internal order must
 * not get a second. Cancelled orders are excluded outright: the buyer's money
 * has gone back. */
export function canCreateInternalOrder(order: {
  cancelledAt?: Date | string | null;
  gateState: string;
  activationCode?: string | null;
  internalStatus?: string | null;
}): boolean {
  return Boolean(
    !order.cancelledAt &&
    order.activationCode &&
    GATE_MINTED.has(order.gateState) &&
    !order.internalStatus,
  );
}

export function wbFunnelStep(order: WbDeliveryPolicyOrder): WbFunnelStep {
  switch (order.internalStatus) {
    case "COMPLETED": return "done";
    case "REJECTED": return "rejected";
    case "ERROR": return "failed";
    case "IN_PROGRESS": return "buying";
    case "PENDING": return "ready_buyout";
    case "AWAITING_PAYMENT":
    case "PAYMENT_PENDING": return "awaiting_payment";
    case "AWAITING_GAMEPASS":
      return order.internalRobloxUsername ? "nick_given" : "instruction";
    default:
      // No internal order at all: the code is minted but nobody has opened it.
      return "not_activated";
  }
}

/** A buyer who cancels on WB gets their money back, but a gate code we already
 * minted stays redeemable until an operator rejects the internal order. Filing
 * those away with the other cancellations would hand out free Robux, so they
 * stay in the queue. Once our own funnel is finished — bought or rejected —
 * there is nothing left to act on and the order goes quiet. */
export function wbCancelledCodeAtRisk(order: WbDeliveryPolicyOrder): boolean {
  return Boolean(
    order.cancelledAt &&
    GATE_MINTED.has(order.gateState) &&
    !FUNNEL_FINISHED.has(order.internalStatus ?? ""),
  );
}

/** Both states mean the buyer's obligation is closed: either we sent a code, or
 * an operator recorded that the order was settled outside this system. */
const GATE_DELIVERED = new Set(["SENT", "SERVED_EXTERNALLY"]);

export function wbGateDelivered(gateState: string): boolean {
  return GATE_DELIVERED.has(gateState);
}

/** Terminal state is read from WB's own status words and from nothing else.
 *
 * It used to accept a `fromCompletedFeed` flag that stamped "completed" on
 * every row of `/api/v3/dbs/orders`. That feed is not a list of completed
 * orders — it is every order in the window, and it carries no status fields at
 * all — so orders the buyer had refused were filed as finished. Worse, once
 * `completedAt` was set the status poller skipped the order forever, which is
 * why a cancellation that arrived afterwards could never be seen.
 *
 * A cancellation always outranks a completion: `receive/canceled` is a return —
 * the money went back, and the order is not finished business. */
export function wbMarketplaceTerminalFlags(
  supplierStatus: string | undefined,
  wbStatus: string | undefined,
) {
  const combined = `${supplierStatus ?? ""} ${wbStatus ?? ""}`;
  // `declin` catches `declined_by_client` — a refusal at the door, which WB
  // leaves sitting in `supplierStatus: new` and which no other word here matches.
  const cancelled = /cancel|reject|declin|defect|refus/i.test(combined);
  return {
    cancelled,
    completed: !cancelled && /sold|receive|complete/i.test(combined),
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
  // A cancelled order is dead weight in the console — unless we already minted
  // a code for it, in which case the buyer has their money back and a working
  // gate, and that has to stay in front of someone.
  if (order.cancelledAt) return wbCancelledCodeAtRisk(order) ? "attention" : "cancelled";
  // Closed at WB but never handed the buyer a gate — the loudest state we have,
  // because the money is settled and the customer is still empty-handed.
  if (isWbBuyerUnserved(order)) return "attention";
  if (order.lastErrorCode) return "attention";
  // Anything we still owe WB outranks waiting on the buyer: this one needs our
  // own receive call, so it must not be filed away as "in the bot".
  if (
    order.gateState === "SENT" &&
    order.hasLiveSecret &&
    /deliver/i.test(order.supplierStatus)
  ) return "ready_receive";
  // The code is out but the buyer still has our funnel to walk: activate it,
  // give a Roblox nick, confirm a game pass. Calling that "complete" hides real
  // work in progress, and calling it "attention" cries wolf on every order.
  if (
    order.gateState === "SENT" &&
    order.internalStatus !== "COMPLETED" &&
    order.internalStatus !== "REJECTED"
  ) return "in_bot";
  if (order.completedAt || /sold|receive|complete/i.test(order.supplierStatus)) return "complete";
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
  /** Сколько раз WB уже отказал по этому коду. Решает, можно ли его заменить. */
  failedAttempts?: number | null;
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
  if (!wbDeliverySecretIsLive(secret, now)) return true;
  // Живой код, который WB уже отклонил, заменить можно — и нужно. Повторы по
  // расписанию длятся часами, и раньше всё это время исправленный код из чата
  // падал в пустоту: `canCapture` видел живой секрет и молча отказывал. До
  // первого отказа замена по-прежнему запрещена, иначе любые цифры в чате
  // затрут код, которым мы прямо сейчас закрываем доставку.
  return (secret?.failedAttempts ?? 0) > 0;
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
    // Delivering the code is the only thing that closes the obligation. Neither
    // minting it nor WB closing the sale counts, so both leave this true.
    !wbGateDelivered(order.gateState),
  );
}

/** The delivery code is not a licence to serve the buyer — it is the argument
 * to our own `receive` call. Wildberries requires the seller to close the
 * delivery, so once the order is closed the code has no remaining job and must
 * not gate anything. Before that, we still need it, so it stays required. */
export function canIssueWbGate(order: WbDeliveryPolicyOrder): boolean {
  if (order.cancelledAt || order.lastErrorCode) return false;
  if (!order.denominationSnapshot || order.gateState !== "NOT_ISSUED") return false;
  if (order.completedAt) return true;
  return order.chatState === "CODE_RECEIVED" && Boolean(order.hasLiveSecret);
}

/** Пауза после N-й неудачной попытки закрыть доставку, в минутах.
 *
 * Первые попытки идут почти подряд — это ловит короткий лаг WB. Дальше паузы
 * растут, потому что лаг WB бывает длинным: 22.08 заказ `5550714937` получил
 * восемь отказов `409` за восемь минут, после чего код считался неверным и
 * стирался, — а ровно тот же код прошёл вручную из кабинета через **3 ч 56 мин**
 * (решение владельца 22.08: повторять «через 10–20–30 минут», а не сдаваться на
 * восьмой минуте). Код, который WB примет через час, не должен быть выброшен
 * через восемь минут.
 *
 * Расписание от первой неудачи: 1, 2, 3, 5, 8, 13, 23, 43 мин, 1 ч 13, 1 ч 58,
 * 2 ч 58, 3 ч 58, 4 ч 58, 5 ч 58 — пятнадцать попыток внутри горизонта. */
export const WB_RECEIVE_RETRY_DELAYS_MIN = [1, 1, 1, 2, 3, 5, 10, 20, 30, 45, 60, 60, 60, 60] as const;

/** Дальше этого срока с момента прихода кода повторять уже некуда: заказ давно
 * разбирает человек, а покупатель ждёт ответа, а не тишины. */
export const WB_RECEIVE_RETRY_HORIZON_MS = 6 * 60 * 60_000;

/** После стольких отказов покупателя просят перепроверить код — но повторы при
 * этом не прекращаются и код не стирается. Восемь минут (шестая попытка) — это
 * примерно столько, сколько человек готов молча ждать, и одновременно достаточно
 * долго, чтобы не дёргать его из-за секундного лага WB. */
export const WB_RECEIVE_RECHECK_AFTER_ATTEMPTS = 6;

/** WB gives roughly an hour from the buyer handing over their code to close the
 * delivery, and that deadline cannot be recovered from. Sending the gate can be
 * retried forever — we keep the chat and the code — so closing must never wait
 * on it. A gate that has not gone out is caught by `isWbBuyerUnserved`, which
 * puts the order in front of the operator until it does.
 *
 * `lastErrorCode` used to be a precondition here and it was a one-way ticket:
 * nothing clears the field automatically, so a chat outage or an expired secret
 * silently disabled closing for that order forever. Retries are now bounded by
 * `failedAttempts` on the secret instead — a counter that only the thing it
 * guards can increment (docs/wb-dbs-review-2026-08-20.md, F2). */
export const WB_RECEIVE_MAX_ATTEMPTS = WB_RECEIVE_RETRY_DELAYS_MIN.length + 1;

/** Сколько времени с момента оформления заказа доставку закрывает бот сам.
 *
 * Решение владельца (21.08.2026): четыре часа. Внутри окна код покупателя —
 * обычный ход заказа, и закрывать надо немедленно: WB даёт на закрытие около
 * часа с момента прихода кода, и это единственный дедлайн, который не отыграть.
 * За окном заказ уже живёт своей жизнью — покупатель успел пожаловаться, заказ
 * мог поехать в отказ, — и «закрыть или отклонить» решает человек. Бот в этом
 * случае делает ровно одно: приносит код доставки в админку. */
export const WB_AUTO_RECEIVE_ORDER_AGE_MS = 4 * 60 * 60_000;

export type WbOrderPlacement = {
  /** Слово самого WB о том, когда заказ оформлен. */
  wbCreatedAt?: Date | string | null;
  /** Когда заказ увидел воркер. Fallback для заказов, заведённых до появления
   * колонки: обычно расходится с `wbCreatedAt` на секунды. */
  firstSeenAt: Date | string;
};

export function wbOrderPlacedAt(order: WbOrderPlacement): Date {
  return new Date(order.wbCreatedAt ?? order.firstSeenAt);
}

/** Разрешено ли боту закрывать эту доставку самому.
 *
 * Окно считается от прихода кода, а не от «сейчас». Код, принятый на третьем
 * часу, обязан пережить лаг WB и восемь минут ретраев — иначе на четвёртом часу
 * бот молча бросил бы заказ, за который уже взялся, ровно в тот момент, когда
 * никто этого не ждёт. */
export function wbAutoReceiveWithinWindow(
  order: WbOrderPlacement,
  codeReceivedAt: Date | string,
): boolean {
  const placed = wbOrderPlacedAt(order).getTime();
  const received = new Date(codeReceivedAt).getTime();
  if (Number.isNaN(placed) || Number.isNaN(received)) return false;
  return received - placed <= WB_AUTO_RECEIVE_ORDER_AGE_MS;
}

/** Возраст заказа в часах на момент прихода кода — для текста уведомления. */
export function wbOrderAgeHours(order: WbOrderPlacement, at: Date | string = new Date()): number {
  const placed = wbOrderPlacedAt(order).getTime();
  if (Number.isNaN(placed)) return 0;
  return Math.max(0, Math.round((new Date(at).getTime() - placed) / 3_600_000));
}

/** Самая короткая пауза расписания.
 *
 * Без паузы бюджет попыток сгорал за секунды: цикл идёт раз в 5 с, поэтому три
 * попытки заканчивались через 10 с после прихода кода (заказ 5540950769,
 * 20.08). Точную паузу считает `wbReceiveRetryDue`; эта константа нужна только
 * как грубый предфильтр выборки в БД, где расписание выразить нечем. */
export const WB_RECEIVE_RETRY_INTERVAL_MS = Math.min(...WB_RECEIVE_RETRY_DELAYS_MIN) * 60_000;

/** Момент, раньше которого секрет трогать не надо ни при каком расписании.
 * Считается по `updatedAt` секрета — строку трогают только захват кода и
 * неудачная попытка, так что это ровно «когда мы последний раз пробовали». */
export function wbReceiveRetryCutoff(now = new Date()): Date {
  return new Date(now.getTime() - WB_RECEIVE_RETRY_INTERVAL_MS);
}

export type WbReceiveRetryState = {
  failedAttempts: number;
  /** Когда пробовали в прошлый раз: строку секрета трогают только захват и отказ. */
  updatedAt: Date | string;
  /** Когда код пришёл от покупателя — от него считается горизонт повторов. */
  receivedAt: Date | string;
};

/** Пауза перед следующей попыткой. `null` — расписание кончилось. */
export function wbReceiveRetryDelayMs(failedAttempts: number): number | null {
  if (failedAttempts < 1) return 0;
  const minutes = WB_RECEIVE_RETRY_DELAYS_MIN[failedAttempts - 1];
  return minutes === undefined ? null : minutes * 60_000;
}

/** Когда наступит следующая попытка. `null` — её не будет. */
export function wbReceiveRetryDueAt(secret: WbReceiveRetryState): Date | null {
  const delay = wbReceiveRetryDelayMs(secret.failedAttempts);
  if (delay === null) return null;
  return new Date(new Date(secret.updatedAt).getTime() + delay);
}

/** Повторять больше нечем: расписание исчерпано или истёк горизонт. Только
 * после этого код считается неверным — и только тогда его можно стирать. */
export function wbReceiveRetriesExhausted(secret: WbReceiveRetryState, now = new Date()): boolean {
  if (secret.failedAttempts >= WB_RECEIVE_MAX_ATTEMPTS) return true;
  if (wbReceiveRetryDelayMs(secret.failedAttempts) === null) return true;
  return new Date(secret.receivedAt).getTime() + WB_RECEIVE_RETRY_HORIZON_MS <= now.getTime();
}

/** Пора пробовать снова. */
export function wbReceiveRetryDue(secret: WbReceiveRetryState, now = new Date()): boolean {
  if (wbReceiveRetriesExhausted(secret, now)) return false;
  const due = wbReceiveRetryDueAt(secret);
  return due !== null && due.getTime() <= now.getTime();
}

/** Гейт уходит покупателю только за закрытой доставкой.
 *
 * 20.08 покупатель прислал код, WB его отклонил — и через секунду получил
 * «Заказ подтверждён» со ссылкой на получение. Порядок обратный тому, который
 * нужен: сначала WB принимает код и доставка закрывается, и только потом
 * покупатель получает свой код гейта. Случайный набор цифр в чате не должен
 * открывать выдачу.
 *
 * Тестовый заказ не ходит в WB вообще, поэтому для него условие снято — иначе
 * демо-прогон невозможен. */
export function canSendWbGate(order: {
  completedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
  isTest?: boolean;
}): boolean {
  if (order.cancelledAt) return false;
  return Boolean(order.completedAt || order.isTest);
}

export function canReceiveWbOrder(order: WbDeliveryPolicyOrder): boolean {
  return Boolean(
    !order.completedAt &&
    !order.cancelledAt &&
    order.hasLiveSecret &&
    (order.secretFailedAttempts ?? 0) < WB_RECEIVE_MAX_ATTEMPTS &&
    /deliver/i.test(order.supplierStatus),
  );
}

/** Which WB status mutation moves this order one step closer to being closable.
 *
 * Nothing in the system used to do this at all: `confirm` and `deliver` were
 * manual buttons, so an order only became receivable if an operator happened to
 * push it through the seller cabinet before the buyer sent their code. Once the
 * auto-reply cut the buyer's response time to minutes, they stopped winning
 * that race — which is the whole of F1. */
export function wbAutoShipAction(supplierStatus: string): "confirm" | "deliver" | null {
  if (/cancel|reject|declin|defect|refus|receive|sold|complete/i.test(supplierStatus)) return null;
  if (/deliver/i.test(supplierStatus)) return null;
  if (/confirm/i.test(supplierStatus)) return "deliver";
  if (/^new$/i.test(supplierStatus.trim())) return "confirm";
  return null;
}
