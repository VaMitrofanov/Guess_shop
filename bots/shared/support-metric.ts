/**
 * Счётчик «где мои робуксы?» (24.10.2026).
 *
 * Без него нельзя понять, работает ли таймер, страница /pending и барьер
 * перед поддержкой: обращения уходят админам в Telegram и нигде не копятся.
 * Пишем два события в `OrderEvent` (таблица уже есть, миграция не нужна):
 *
 *  • ROBUX_QUESTION_SELF_SERVED — бот ответил сам (таймер или этап заказа);
 *  • SUPPORT_REQUEST_DELIVERED  — обращение ушло менеджеру; в payload тема:
 *    про робуксы ли оно (`robux: true`).
 *
 * Сводка по неделям — `scripts/robux-question-metric.ts`. Без заказа событие
 * не пишется (у OrderEvent обязательный orderId) — это вопросы людей, у
 * которых заказов нет вовсе, и к «где робуксы» они почти не относятся.
 * Никогда не бросает: метрика не должна ронять ответ покупателю.
 */

export const SUPPORT_METRIC_EVENT = {
  SELF_SERVED: "ROBUX_QUESTION_SELF_SERVED",
  DELIVERED: "SUPPORT_REQUEST_DELIVERED",
  /* Опрос «пришли ли робуксы?» (рассылка 26.10.2026): по типу на ответ, чтобы
     смена ответа в пределах окна не терялась; итог — последний по времени. */
  SURVEY_GOT: "ROBUX_SURVEY_GOT",
  SURVEY_PENDING: "ROBUX_SURVEY_PENDING",
  SURVEY_NONE: "ROBUX_SURVEY_NONE",
} as const;

/** Окно, в котором повтор того же события по заказу не плодит строк. */
const BUCKET_MS = 10 * 60 * 1000;

export type SupportMetricClient = {
  wbOrder: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
  orderEvent: { create: (args: unknown) => Promise<unknown> };
};

/** Контексты обращений, которые сами по себе про робуксы. */
const ROBUX_CONTEXTS = new Set(["robux_overdue", "robux_low_pending", "robux_low_pending_retry"]);

export function isRobuxSupportContext(contextKey: string | null | undefined): boolean {
  return ROBUX_CONTEXTS.has(contextKey ?? "");
}

export async function recordSupportMetric(
  client: SupportMetricClient,
  input: {
    type: (typeof SUPPORT_METRIC_EVENT)[keyof typeof SUPPORT_METRIC_EVENT];
    orderId?: string | null;
    wbCode?: string | null;
    via: "tg-bot" | "vk-bot" | "wb-chat";
    payload?: Record<string, unknown>;
    now?: number;
  },
): Promise<void> {
  try {
    let orderId = input.orderId ?? null;
    if (!orderId && input.wbCode) {
      const order = await client.wbOrder.findFirst({ where: { wbCode: input.wbCode }, select: { id: true } });
      orderId = order?.id ?? null;
    }
    if (!orderId) return;
    const bucket = Math.floor((input.now ?? Date.now()) / BUCKET_MS);
    await client.orderEvent.create({
      data: {
        orderId,
        type: input.type,
        idempotencyKey: `${input.type}:${orderId}:${bucket}`,
        payload: { via: input.via, ...(input.payload ?? {}) },
      },
    });
  } catch {
    /* дубль в окне (P2002) или сбой БД — метрика не важнее ответа */
  }
}
