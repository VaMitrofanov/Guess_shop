/**
 * Границы общей очереди выкупа («К выкупу»).
 *
 * С 2026-07-25 выкуп ручной и без разделения на аккаунты, поэтому оплаченный прямой заказ
 * лежит в той же очереди, что WB/сайт/ручной — менеджеру не нужно обходить две папки.
 * Единственное исключение — прямой заказ без подтверждённой оплаты
 * (`isDirectOrder && paidAt == null`): он вне всех путей выкупа (TWA-очередь, кнопки
 * покупки, авто-воркер) и ждёт «✅ Оплата пришла» в TG-карточке.
 *
 * Модуль чистый (без prisma/react), чтобы одно и то же правило использовали серверный
 * фильтр, SQL-счётчики и экраны TWA.
 */

export type BuyoutQueueOrder = {
  isDirectOrder: boolean;
  paidAt: string | Date | null;
  status: string;
  orderSource?: string | null;
};

/** Prisma-фрагмент: «кроме неоплаченного прямого». */
export const PAID_BUYOUT_SCOPE = { NOT: { isDirectOrder: true, paidAt: null } } as const;

/** Тот же предикат для сырых SQL-счётчиков. */
export const PAID_BUYOUT_SQL = `NOT ("isDirectOrder" = true AND "paidAt" IS NULL)`;

/** Статусы, в которых заказ считается ожидающим ручного выкупа. */
export const BUYOUT_QUEUE_STATUSES = ["PENDING", "IN_PROGRESS"] as const;

/** Прямой заказ без подтверждённой оплаты — вне очереди выкупа. */
export function isUnpaidDirect(order: Pick<BuyoutQueueOrder, "isDirectOrder" | "paidAt">): boolean {
  return order.isDirectOrder && !order.paidAt;
}

/**
 * Заказ находится в общей очереди «К выкупу». Авито считается отдельной очередью
 * (у неё своя вкладка и свой источник), поэтому в общую не входит.
 */
export function belongsToBuyoutQueue(order: BuyoutQueueOrder): boolean {
  if (order.orderSource === "AVITO") return false;
  if (isUnpaidDirect(order)) return false;
  return (BUYOUT_QUEUE_STATUSES as readonly string[]).includes(order.status);
}
