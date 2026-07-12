/**
 * Прайс-гард выкупа (PLAN-gp-price-guard, инцидент 2026-07-12): геймпасс
 * покупается ТОЛЬКО по цене, совпадающей с ожидаемой по номиналу заказа.
 * Клиент, поднявший цену пасса после приёма ботом, раньше получал выкуп по
 * live-цене без сверки (TOCTOU) — заказ на 500 закрылся покупкой за 1143.
 *
 * Формула и допуск — эталон автовыкупа (bots/tg/auto-workers.ts):
 * expected = ceil(amount / 0.7), допуск ±PRICE_TOL. Для DIR-заказов amount
 * уже включает бонус (totalAmount), для WB/Avito amount = номинал.
 */
export const PRICE_TOL = 2;

export const expectedGamepassPrice = (amount: number): number => Math.ceil(amount / 0.7);

export function checkGamepassPrice(
  amount: number,
  livePrice: number,
): { ok: boolean; expected: number } {
  const expected = expectedGamepassPrice(amount);
  return { ok: Math.abs(livePrice - expected) <= PRICE_TOL, expected };
}

/**
 * Продавец пасса должен совпадать с подтверждённым ником заказа
 * (case-insensitive, как seller-check автовыкупа). Нет данных — не блокируем.
 */
export function sellerMatchesOrder(
  orderNick: string | null | undefined,
  creatorName: string | null | undefined,
): boolean {
  if (!orderNick || !creatorName) return true;
  return orderNick.toLowerCase() === creatorName.toLowerCase();
}
