/**
 * State machine for VK users.
 *
 * States:
 *  AWAITING_LINK            — user activated a WB code and must send a gamepass URL
 *  AWAITING_API_KEY         — user is in the "make it for me" branch; next text is the Open Cloud key
 *  AWAITING_REVIEW          — user's order was COMPLETED; waiting for review screenshot
 *  AWAITING_DIRECT_AMOUNT   — user opened direct order flow; waiting for robux amount
 *  AWAITING_DIRECT_CONFIRM  — amount entered; waiting for confirm/cancel button
 *  AWAITING_DIRECT_PAYMENT  — payment details sent; waiting for payment screenshot
 *
 * Storage: in-memory Map (VK numeric user ID → state).
 * On process restart the bot re-derives state from the DB (see handlers.ts).
 */

interface DirectFlowData {
  amount: number;
  totalAmount: number;
  bonus: number;
  rubleDiscount: number;
  rublePrice: number;
  /** Ф4 (О1): флоу 5 шагов с экраном «🎁 Бонус» (bonus>0) или 4 шага без него.
   *  Фиксируется при выборе пака и не меняется, даже если юзер выбрал «Без бонуса». */
  hasBonusStep: boolean;
}

export type VKState =
  // viaManualLink: покупателя привёл сюда провалившийся поиск по нику (кнопка
  // «🔗 Прислать ссылку» или ссылка, присланная вместо ника). Метка едет в
  // карточку админа — такой заказ почти всегда про скрытый плейс.
  | { type: "AWAITING_LINK";           wbCode: string; denomination: number; viaManualLink?: boolean }
  | { type: "AWAITING_REVIEW";         orderId: string }
  | { type: "AWAITING_DIRECT_AMOUNT" }
  | { type: "AWAITING_DIRECT_CONFIRM" } & DirectFlowData
  | { type: "AWAITING_DIRECT_NICK";       } & DirectFlowData
  | { type: "AWAITING_DIRECT_NICK_INPUT"; } & DirectFlowData
  | { type: "AWAITING_DIRECT_GAMEPASS";   robloxUsername: string } & DirectFlowData
  | { type: "AWAITING_DIRECT_SUMMARY";    robloxUsername: string; gamepassId: string; gamepassUrl: string; gamepassName: string; gamepassRobux?: number } & DirectFlowData
  | { type: "AWAITING_DIRECT_RECEIPT"; intentId: string; method: "SITE" | "BOT_ACQUIRING" | "MANUAL_TRANSFER" }
  | { type: "AWAITING_DIRECT_PAYMENT"; orderId: string }
  | { type: "AWAITING_ROBLOX_NICK";    wbCode: string; denomination: number }
  // Ветка «сделаем за тебя»: следующий текст — Open Cloud ключ покупателя, а не
  // ник и не ссылка. Отдельный стейт, потому что ключ — длинная строка, и в
  // разборе ника он получил бы «ник не похож на ник Roblox».
  | { type: "AWAITING_API_KEY";        wbCode: string; denomination: number; nick: string }
  /* То же для ПРЯМОГО заказа: кода WB у него нет, зато есть весь флоу — после
     создания пасса человек возвращается к подтверждению заказа, а не в квест. */
  | { type: "AWAITING_DIRECT_API_KEY"; robloxUsername: string; passPrice: number } & DirectFlowData
  | { type: "AWAITING_NICK_EDIT" };

const store = new Map<number, VKState>();

export function getState(vkUserId: number): VKState | undefined {
  return store.get(vkUserId);
}

export function setState(vkUserId: number, state: VKState): void {
  store.set(vkUserId, state);
}

export function clearState(vkUserId: number): void {
  store.delete(vkUserId);
}

/**
 * Разбор аккаунта, показанный покупателю последним (квест «что нашли → как
 * сделаем»). Держим ЦЕЛИКОМ: подтверждение оформляет заказ по всему набору
 * (заказ на 2000 закрывается парой пассов), а ветка ключа пересчитывает план
 * по тому, что мы только что создали.
 */
export interface VkQuestPlan {
  wbCode: string;
  denomination: number;
  nick: string;
  plan: import("../shared/gamepass-plan").CheckPlan;
  owned: import("../shared/gamepass-plan").OwnedPass[];
}

const questStore = new Map<number, VkQuestPlan>();

export function getQuestPlan(vkUserId: number): VkQuestPlan | undefined {
  return questStore.get(vkUserId);
}

export function setQuestPlan(vkUserId: number, plan: VkQuestPlan): void {
  questStore.set(vkUserId, plan);
}

export function clearQuestPlan(vkUserId: number): void {
  questStore.delete(vkUserId);
}
