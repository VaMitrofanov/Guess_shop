/**
 * «Повторный клиент» — один счёт на все карточки.
 *
 * Разбор 07.09.2026 по `JS6NQB9`: карточка выкупа объявила первого в жизни
 * покупателя повторным. Считалось «всё, кроме `AWAITING_GAMEPASS`», а у
 * человека висел брошенный заказ с сайта в `PAYMENT_PENDING` — тот самый, в
 * который его увела кривая ссылка из кабинета. Деньги по нему не приходили
 * никогда, но для счётчика он был полноценным заказом.
 *
 * Правило: прошлым заказом считается тот, по которому мы что-то ДЕЛАЛИ.
 * Незакрытая корзина (ждёт геймпасс) и неоплаченная касса (ждёт денег) — не
 * заказы. У веб-роута оформления счёт был свой (`status: COMPLETED`), и это
 * давало третий ответ на тот же вопрос — теперь ответ один на всех.
 */

/** Статусы, которые НЕ считаются прошлым заказом. */
export const LOYALTY_EXCLUDED_STATUSES = [
  "AWAITING_GAMEPASS",
  "AWAITING_PAYMENT",
  "PAYMENT_PENDING",
] as const;

export type LoyaltyCountClient = {
  wbOrder: { count: (args: { where: Record<string, unknown> }) => Promise<number> };
};

/**
 * Сколько заказов у покупателя БЫЛО до этого.
 *
 * Текущий заказ исключается по id или по коду: свежепромоутнутый заказ иначе
 * считает сам себя и делает первого покупателя повторным.
 */
export async function countPreviousOrders(
  db: LoyaltyCountClient,
  opts: { userId: string; excludeOrderId?: string | null; excludeWbCode?: string | null },
): Promise<number> {
  const where: Record<string, unknown> = {
    userId: opts.userId,
    status: { notIn: [...LOYALTY_EXCLUDED_STATUSES] },
  };
  if (opts.excludeOrderId) where.id = { not: opts.excludeOrderId };
  if (opts.excludeWbCode) where.wbCode = { not: opts.excludeWbCode };
  return db.wbOrder.count({ where }).catch(() => 0);
}
