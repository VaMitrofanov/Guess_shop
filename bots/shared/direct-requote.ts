/* ─────────────────────────────────────────────────────────────────────────────
   Прямой заказ под цену выбранного пасса.

   Разбор `DIR-39544969` (08.09.2026). Клиент оформил заказ на 200 R$ и привязал
   к нему пасс за 715 R$ — цену для заказа на 500. Бот сам предложил этот пасс
   кнопкой («нет пассов с нужной ценой — вот что нашлось»), а на итоговом экране
   ограничился предупреждением: кнопка «✅ Оформить» оставалась живой. Заказ
   доехал до очереди выкупа, где 715 R$ стоили бы 274 ₽ при оплате в 144 ₽.

   Правильный ответ — не отказ, а честный пересчёт: у пасса за 715 R$ есть своя
   цена заказа, и её можно назвать. Клиент решает сам: «едем на 500 R$ за столько
   же» или «сделаю пасс на нужную цену».

   Модуль намеренно чистый — ни базы, ни Roblox, ни телеграма: одно правило на
   TG, VK и серверный гейт приёма заказа.
   ───────────────────────────────────────────────────────────────────────── */

import { expectedGamepassPrice } from "./gamepass-plan";
import { CUSTOM_MAX, CUSTOM_MIN, directPrice } from "./retail-pricing";

/** Допуск цены — тот же, что у прайс-гарда выкупа (`PRICE_TOL`). */
export const PASS_PRICE_TOL = 2;

/**
 * Сколько чистых R$ донесёт до покупателя пасс за такую цену.
 * Roblox удерживает 30% с продажи — это обратная сторона `expectedGamepassPrice`.
 */
export function robuxFromPassPrice(passPrice: number): number {
  if (!Number.isFinite(passPrice) || passPrice <= 0) return 0;
  return Math.floor(passPrice * 0.7);
}

/** Пасс годится под этот объём заказа? */
export function passFitsAmount(passPrice: number, totalAmount: number): boolean {
  if (!Number.isFinite(passPrice) || !Number.isFinite(totalAmount) || totalAmount <= 0) return false;
  return Math.abs(passPrice - expectedGamepassPrice(totalAmount)) <= PASS_PRICE_TOL;
}

export interface DirectRequote {
  /** Сколько R$ получит покупатель (оплаченные + бонус). */
  totalAmount: number;
  /** Оплачиваемая часть — из неё считается рублёвая цена. */
  amount: number;
  /** Цена пасса, под которую всё сходится. */
  passPrice: number;
  /** К оплате в рублях с учётом персональной скидки. */
  rublePrice: number;
}

/**
 * Пересчитать заказ под уже существующий пасс.
 *
 * `null` означает «пересчёт невозможен» и требует другого ответа: пасс дешевле
 * минимального заказа (или бонус больше, чем несёт пасс), дороже потолка, либо
 * цена такая, что обратный расчёт не сходится сам с собой (кривые номиналы
 * вроде 3 R$ — там `floor`/`ceil` расходятся сильнее допуска).
 */
export function requoteForPass(opts: {
  passPrice: number;
  /** Бонусные R$ остаются с покупателем: платит он только за свою часть. */
  bonus?: number;
  /** Персональная рублёвая скидка. */
  rubleDiscount?: number;
}): DirectRequote | null {
  const bonus = Math.max(0, Math.round(opts.bonus ?? 0));
  const discount = Math.max(0, Math.round(opts.rubleDiscount ?? 0));
  const totalAmount = robuxFromPassPrice(opts.passPrice);
  if (totalAmount <= 0) return null;
  // Само-проверка: пересчитанный объём обязан требовать ровно этот пасс, иначе
  // мы предложили бы цену, по которой выкуп тут же встанет на ЦЕНА-СТОП.
  if (!passFitsAmount(opts.passPrice, totalAmount)) return null;

  const amount = totalAmount - bonus;
  if (amount < CUSTOM_MIN || amount > CUSTOM_MAX) return null;

  return {
    totalAmount,
    amount,
    passPrice: expectedGamepassPrice(totalAmount),
    rublePrice: Math.max(0, directPrice(amount) - discount),
  };
}
