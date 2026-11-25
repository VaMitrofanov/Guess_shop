/* ─────────────────────────────────────────────────────────────────────────────
   Действия с заказом — ОДИН реестр на меню «···» и шторку TWA, досье сайта и
   сервер (`/api/twa/orders`), по образцу `gamepass-tools.ts` (25.11.2026).

   До этого каждая поверхность вписывала свои списки статусов прямо в разметку,
   и они разъехались: TWA предлагала «Пометить ошибкой» заказу, который ждёт
   пасс (сервер отвечал 400), и «Редактировать» замороженному (сервер 409);
   одно действие называлось по-разному в меню, шторке и на сайте.

   Статусы ниже — те, что принимает сервер; роут читает их отсюда же.
   ───────────────────────────────────────────────────────────────────────── */

export type OrderActionId =
  | "edit" | "rebind" | "move" | "error" | "hold" | "unhold" | "favorite"
  | "priority" | "reject" | "rebuy" | "resend" | "refund" | "trace";

export interface OrderActionMeta {
  icon: string;
  label: string;
}

/** Имена одинаковые на всех поверхностях. */
export const ORDER_ACTIONS: Record<OrderActionId, OrderActionMeta> = {
  edit: { icon: "✏️", label: "Редактировать" },
  rebind: { icon: "🔄", label: "Перепривязать" },
  move: { icon: "↪️", label: "Переместить в раздел" },
  error: { icon: "⚠️", label: "Пометить ошибкой" },
  hold: { icon: "❄️", label: "Заморозить" },
  unhold: { icon: "❄️", label: "Разморозить" },
  favorite: { icon: "★", label: "В избранное" },
  priority: { icon: "⚡", label: "Вперёд очереди" },
  reject: { icon: "✕", label: "Отменить заказ" },
  rebuy: { icon: "🔁", label: "Не дошло — выкупить снова" },
  resend: { icon: "📨", label: "Повторить уведомление о выкупе" },
  refund: { icon: "↩️", label: "Оформить возврат" },
  trace: { icon: "🕵", label: "След покупателя" },
};

/** Вторые состояния переключателей. */
export const ORDER_ACTION_OFF_LABEL = {
  favorite: "Из избранного",
  priority: "Вернуть в очередь",
} as const;

/** `edit-order`. Выкупленный правится с 10.11.2026 (запись, не выкуп). */
export const EDITABLE_STATUSES = ["PENDING", "AWAITING_GAMEPASS", "ERROR", "REJECTED", "COMPLETED"];
/** `rebind-order`. */
export const REBINDABLE_STATUSES = ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR", "REJECTED"];
/** `set-error`: ошибкой метят только то, что выкупается. */
export const ERRORABLE_STATUSES = ["PENDING", "IN_PROGRESS"];
/** `reject`. */
export const REJECTABLE_STATUSES = ["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS", "AWAITING_PAYMENT", "PAYMENT_PENDING", "ERROR"];
/** `set-priority`: поднять можно только то, что стоит в очереди. */
export const QUEUEABLE_STATUSES = ["PENDING", "IN_PROGRESS", "ERROR", "AWAITING_GAMEPASS", "AWAITING_PAYMENT", "PAYMENT_PENDING"];

const CLOSED_STATUSES = ["COMPLETED", "REJECTED"];

export interface OrderActionOrder {
  status: string;
  heldAt?: string | Date | null;
}

/**
 * Можно ли предложить действие этому заказу — только по статусу и заморозке.
 * Действия, которым нужно больше (платёж у возврата, история у «не дошло»,
 * раздел у перемещения), досчитывают свои условия на месте.
 */
export function canOrderAction(order: OrderActionOrder, id: OrderActionId): boolean {
  const held = Boolean(order.heldAt);
  switch (id) {
    case "edit": return !held && EDITABLE_STATUSES.includes(order.status);
    case "rebind": return REBINDABLE_STATUSES.includes(order.status);
    case "error": return !held && ERRORABLE_STATUSES.includes(order.status);
    case "reject": return REJECTABLE_STATUSES.includes(order.status);
    case "priority": return !held && QUEUEABLE_STATUSES.includes(order.status);
    case "hold": return !held && !CLOSED_STATUSES.includes(order.status);
    case "unhold": return held;
    case "resend": return order.status === "COMPLETED";
    default: return true;
  }
}
