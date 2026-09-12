import "server-only";

import { prisma } from "@/lib/prisma";

/* ─────────────────────────────────────────────────────────────────────────────
   Журнал переходов статуса заказа (решение О5 от 03.09.2026).

   До этого у `WbOrder` не было записи о смене статуса. Момент «встал в очередь»
   и «выкуплен» ещё можно прочитать по `pendingAt` / `completedAt`, но «ушёл в
   ошибку», «отменён», «вернули к выкупу» — только по `updatedAt`, а он
   двигается от любой правки: от заметки, от избранного, от заморозки. Лента
   смены на таком поле показывала бы время последнего касания вместо времени
   события — и врала бы ровно там, где на неё смотрят.

   Запись — побочный эффект: она никогда не роняет действие админа. Заказ
   важнее записи о нём.
   ───────────────────────────────────────────────────────────────────────── */

export const ORDER_STATUS_EVENT = "ORDER_STATUS_CHANGED";

/**
 * Записать переход статуса.
 *
 * `idempotencyKey` уникален глобально, а один и тот же переход законно
 * случается несколько раз (PENDING → ERROR → PENDING → ERROR), поэтому в ключ
 * входит момент времени: дедуплицировать тут нечего, каждая смена — отдельный
 * факт.
 */
export async function recordOrderStatusChange(opts: {
  orderId: string;
  from: string | null;
  to: string;
  /** Кто сменил: `admin:Имя`, `bot`, `worker`, `client`. */
  actor: string;
  /** Причина, если она была названа (отмена, ошибка). */
  reason?: string | null;
  /** Что ещё полезно знать ленте: код, сумма, источник. */
  extra?: Record<string, unknown>;
}): Promise<void> {
  if (opts.from === opts.to) return;
  try {
    await prisma.orderEvent.create({
      data: {
        orderId: opts.orderId,
        type: ORDER_STATUS_EVENT,
        idempotencyKey: `status:${opts.orderId}:${opts.from ?? "—"}>${opts.to}:${Date.now()}`,
        payload: {
          from: opts.from,
          to: opts.to,
          actor: opts.actor,
          ...(opts.reason ? { reason: opts.reason } : {}),
          ...(opts.extra ?? {}),
          at: new Date().toISOString(),
        },
      },
    });
  } catch (err) {
    console.warn("[order-status-event] не записан:", err instanceof Error ? err.message : err);
  }
}
