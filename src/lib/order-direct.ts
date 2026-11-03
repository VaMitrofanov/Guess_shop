/**
 * «Прямой заказ» — одно понятие, два поля, и они обязаны совпадать.
 *
 * `orderSource` отвечает на «откуда пришёл» (фильтр «Прямые», значок полосы),
 * `isDirectOrder` — на «как с ним работать»: он поднимает заказ вверх «К выкупу»
 * (`DIRECT_ORDER_BY`), кладёт его в полосу и вкладку «Прямой», включает гейт
 * оплаты и прямой сценарий уведомлений.
 *
 * 19.10.2026 они разъехались на `MN-MVF55KPOH1BY`: админ создал заказ руками как
 * обычный, затем в правке сменил источник на «Прямой». Правка писала только
 * `orderSource` — фильтр «Прямые» заказ видел, а очередь нет, и наверх он не
 * встал. Правило: смена источника из любого места меняет оба поля сразу, через
 * эту функцию.
 *
 * Модуль чистый (без prisma), чтобы правило проверялось тестом.
 */

/** Источники, заказ из которых по природе прямой (оплачен нам, а не WB). */
export const DIRECT_SOURCES: readonly string[] = ["DIRECT", "SITE"];

export const isDirectSource = (source: string | null | undefined): boolean =>
  !!source && DIRECT_SOURCES.includes(source);

export type DirectSyncOrder = {
  orderSource: string;
  isDirectOrder: boolean;
  paidAt: Date | string | null;
  saleAmountKopecks?: number | null;
  paymentDetails?: string | null;
};

export type DirectSyncPatch = {
  isDirectOrder?: boolean;
  paidAt?: Date;
  paymentDetails?: string;
  saleAmountKopecks?: number;
};

/**
 * Что ещё записать вместе со сменой источника на `next`.
 *
 * - Стал прямым → `isDirectOrder = true`. Оплату подтверждает тот же менеджер,
 *   что ставит источник, — ровно как при ручном создании прямого заказа
 *   (`create-manual`, «подтверждён менеджером»). Без `paidAt` заказ попал бы
 *   под гейт «прямой без оплаты» и выпал бы из выкупа вовсе — хуже, чем было.
 * - Перестал быть прямым → `isDirectOrder = false`. Неоплаченный прямой сюда не
 *   доходит: правка такого заказа отказывает раньше (`UNPAID_DIR_ERROR`), иначе
 *   смена источника стала бы обходом оплаты.
 *
 * `directSaleKopecks` — цена прямого заказа на этот номинал; пишется, только
 * если суммы продажи у заказа ещё нет (иначе экономика заказа потеряет деньги,
 * которые уже записаны).
 */
export function directPatchForSource(
  order: DirectSyncOrder,
  next: string,
  opts: { now: Date; directSaleKopecks: number; actor: string },
): DirectSyncPatch {
  const wantDirect = isDirectSource(next);
  if (wantDirect === order.isDirectOrder) return {};
  if (!wantDirect) return { isDirectOrder: false };
  const patch: DirectSyncPatch = { isDirectOrder: true };
  if (!order.paidAt) {
    patch.paidAt = opts.now;
    if (!order.paymentDetails)
      patch.paymentDetails = `Прямой заказ: источник выставлен вручную, оплату подтвердил ${opts.actor}`;
  }
  if (order.saleAmountKopecks == null && opts.directSaleKopecks > 0)
    patch.saleAmountKopecks = opts.directSaleKopecks;
  return patch;
}
