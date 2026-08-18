import type { WbDeliveryStage, WbFunnelStep } from "../../bots/shared/wb-delivery-policy";

/** Operator-facing wording for the DBS console, shared by the TWA queue and the
 * desktop journal. Both surfaces render the same DTO, so they must not invent
 * their own vocabulary — an order called "Ждём код" in one place and "Запрошен
 * код" in the other reads as two different states to the person on shift. */

export const WB_STAGE_LABEL: Record<WbDeliveryStage, string> = {
  attention: "Нужна проверка",
  new: "Новый",
  chat_ready: "Чат открыт",
  waiting_code: "Ждём код",
  code_received: "Код получен",
  gate_ready: "Гейт готов",
  link_sent: "Ссылка отправлена",
  ready_receive: "Закрыть на WB",
  in_bot: "В нашем боте",
  complete: "Завершён",
  cancelled: "Отменён",
};

/** Stages that owe the operator an action right now. The urgent tab and its
 * badge both read this, so the count can never disagree with the list. */
export const WB_URGENT_STAGES: readonly WbDeliveryStage[] = [
  "attention",
  "code_received",
  "gate_ready",
  "ready_receive",
];

/** Stages that are over: nothing to do, safe to file away. */
export const WB_TERMINAL_STAGES: readonly WbDeliveryStage[] = ["complete", "cancelled"];

/** «В работе» grouped by who owes the next move. A flat list made an order
 * waiting on a game pass look identical to one waiting on our own code, which
 * is the whole reason the tab was hard to read. Every non-terminal stage must
 * belong to exactly one section — a stage missing here would vanish from the
 * queue entirely. */
export const WB_QUEUE_SECTIONS = [
  {
    id: "ours",
    title: "Наш ход",
    hint: "требуют действия прямо сейчас",
    stages: ["attention", "code_received", "gate_ready", "ready_receive"],
  },
  {
    id: "buyer",
    title: "Ждём покупателя",
    hint: "мяч на стороне WB-чата",
    stages: ["new", "chat_ready", "waiting_code"],
  },
  {
    id: "bot",
    title: "В нашем боте",
    hint: "код выдан, покупатель идёт по воронке",
    stages: ["link_sent", "in_bot"],
  },
] as const satisfies readonly { id: string; title: string; hint: string; stages: readonly WbDeliveryStage[] }[];

/** Where the buyer stands inside our own funnel after the gate goes out. This
 * is the detail «В нашем боте» was hiding. */
export const WB_FUNNEL_LABEL: Record<WbFunnelStep, string> = {
  not_activated: "Код не активирован",
  instruction: "Читает инструкцию",
  nick_given: "Ник получен",
  ready_buyout: "Геймпасс есть · к выкупу",
  buying: "Выкупается",
  done: "Выкуплен",
  rejected: "Отклонён",
  failed: "Ошибка выкупа",
  awaiting_payment: "Ждёт оплату",
};

/** One-line answer to "what do I do with this?" for the funnel steps that need
 * a human. Steps that resolve themselves are deliberately absent. */
export const WB_FUNNEL_HINT: Partial<Record<WbFunnelStep, string>> = {
  not_activated: "Покупатель ещё не открыл ссылку из чата WB",
  instruction: "Ждём ник Roblox от покупателя",
  nick_given: "Ждём подтверждение геймпасса",
  ready_buyout: "Ждёт в очереди выкупа",
  failed: "Разберите заказ во вкладке «Заказы»",
};

export const WB_GATE_STATE_LABEL: Record<string, string> = {
  NOT_ISSUED: "Не выпущен",
  ISSUED: "Выпущен",
  SENDING: "Отправляется",
  SENT: "Отправлен покупателю",
  SEND_UNKNOWN: "Исход отправки неизвестен",
  REVOKED: "Аннулирован",
  SERVED_EXTERNALLY: "Выдан вне системы",
};

export const WB_CHAT_STATE_LABEL: Record<string, string> = {
  WAITING_BUYER_CHAT: "Покупатель не писал",
  READY: "Чат открыт",
  CODE_REQUESTED: "Код запрошен",
  REQUEST_SEND_UNKNOWN: "Запрос — исход неизвестен",
  CODE_RECEIVED: "Код получен",
};

/** WB's own vocabulary for the marketplace side of the order. */
export const WB_SUPPLIER_STATUS_LABEL: Record<string, string> = {
  new: "Новый",
  confirm: "На сборке",
  deliver: "В доставке",
  receive: "Получен",
  sold: "Продан",
  cancel: "Отменён",
  canceled: "Отменён",
  cancel_client: "Отменён покупателем",
  declined_by_client: "Отклонён покупателем",
  reject: "Отклонён",
  complete: "Завершён",
  waiting: "Ожидает",
  sorted: "Отсортирован",
  ready_for_pickup: "Готов к выдаче",
};

const AUDIT_LABEL: Record<string, string> = {
  ORDER_SYNCED: "Заказ синхронизирован",
  DELIVERY_CODE_REQUESTED: "Запрошен код получения",
  DELIVERY_CODE_CAPTURED: "Код получения принят",
  DELIVERY_CODE_EXPIRED: "Код получения истёк",
  GATE_CODE_ISSUED: "Выпущен код гейта",
  GATE_SEND_STARTED: "Началась отправка гейта",
  GATE_LINK_SENT: "Гейт отправлен покупателю",
  GATE_MANUALLY_MARKED_SENT: "Гейт отмечен отправленным вручную",
  GATE_SERVED_EXTERNALLY: "Отмечен как выданный вне системы",
  AUTO_GATE_ISSUED_AND_SENT: "Авто-гейт выпущен и отправлен",
  AUTO_GATE_SEND_FAILED: "Авто-гейт не отправлен",
  WB_CONFIRM_SUCCEEDED: "Сборка подтверждена",
  WB_DELIVER_SUCCEEDED: "Передан в доставку",
  WB_RECEIVE_SUCCEEDED: "Доставка закрыта на WB",
  WB_STATUS_MUTATION_FAILED: "WB отклонил смену статуса",
  CHAT_MESSAGE_SENT: "Сообщение отправлено",
  CHAT_SEND_FAILED: "WB отклонил отправку",
  CHAT_MIRROR_FAILED: "Сообщение не отражено в истории",
  BUYER_NAME_RESOLVED: "Имя покупателя получено",
};

/** Never show a raw enum to the operator; an unmapped type degrades to readable
 * words instead of SCREAMING_SNAKE_CASE. */
export function wbAuditLabel(type: string): string {
  return AUDIT_LABEL[type] ?? type.toLowerCase().replaceAll("_", " ");
}

export function wbGateStateLabel(state: string): string {
  return WB_GATE_STATE_LABEL[state] ?? state;
}

export function wbSupplierStatusLabel(status: string): string {
  return WB_SUPPLIER_STATUS_LABEL[status?.toLowerCase()] ?? status ?? "—";
}
