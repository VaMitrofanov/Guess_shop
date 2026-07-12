/**
 * Ф5 (2026-07-12): уведомление о выкупе = ДВА сообщения.
 *
 *  • msg1 — операционное (всем, всегда): факт выкупа + дата разблокировки
 *    робуксов (completedAt + 5 дней) + как проверить. Никакого маркетинга.
 *  • msg2 — бонусное (отдельным сообщением сразу после), по приоритету:
 *      1. WB-заказ, бонус не на балансе, код не заклеймлен → питч отзыва,
 *         кнопки [📸 Прислать отзыв] [💎 Купить напрямую] (О2);
 *      2. бонус на балансе → «у тебя бонус N R$ до {дата}» + [💎 Использовать бонус];
 *      3. повторный WB-клиент → TIER-2 питч закрытого формата (без изменений);
 *      4. прямой заказ → «спасибо/N-й заказ» (+скидка 60 ₽ для DIR <500).
 *
 * Кнопки TG и VK одинаковые по названию и действию (TG callback = VK payload
 * command: review_hint / start_direct).
 *
 * Модуль используется notifyUserCompleted (bots/tg/handlers.ts); зеркало для
 * Next-роутов — src/lib/twa-notify.ts (bots/ и src/ не импортируют друг друга,
 * менять СИНХРОННО).
 */

/** Roblox держит робуксы за геймпасс в Pending ~5 дней. */
export const ROBUX_UNLOCK_DAYS = 5;

export function robuxUnlockDate(completedAt: Date): Date {
  return new Date(completedAt.getTime() + ROBUX_UNLOCK_DAYS * 86_400_000);
}

export function fmtDateRu(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
}

export type CompletedButton = {
  label: string;
  /** TG callback_data и VK payload.command — одинаковые строки. */
  command: "review_hint" | "start_direct";
};

export interface CompletedMessagesInput {
  isDirectOrder: boolean;
  /** Все COMPLETED-заказы юзера (включая этот). */
  completedCount: number;
  /** Момент выкупа (WbOrder.completedAt); null у легаси-путей → сейчас. */
  completedAt: Date | null;
  /** user.reviewBonusGrantedAt — бонус сейчас на балансе (крон обнуляет по истечении). */
  bonusGrantedAt: Date | null;
  /** user.balance (R$ бонуса). */
  bonusBalance: number;
  /** WbCode этого заказа существует и reviewBonusClaimed=false (WB-код, отзыв ещё не оплачен). */
  codeUnclaimed: boolean;
  /** DIR <500 R$ — начислена скидка 60 ₽ (сайд-эффект на вызывающей стороне). */
  discountGranted: boolean;
}

export interface CompletedMessages {
  kind: "review_pitch" | "bonus_reminder" | "tier2" | "thanks";
  /** HTML-версии для TG. */
  tgMsg1: string;
  tgMsg2: string;
  /** Plain-версии для VK (ссылки текстом). */
  vkMsg1: string;
  vkMsg2: string;
  buttons: CompletedButton[];
}

const BTN_REVIEW: CompletedButton = { label: "📸 Прислать отзыв", command: "review_hint" };
const BTN_DIRECT: CompletedButton = { label: "💎 Купить напрямую", command: "start_direct" };
const BTN_USE_BONUS: CompletedButton = { label: "💎 Использовать бонус", command: "start_direct" };

const BONUS_EXPIRY_DAYS = 30; // = REVIEW_BONUS_EXPIRY_DAYS (review-eligibility.ts)

export function buildCompletedMessages(inp: CompletedMessagesInput): CompletedMessages {
  const unlockStr = fmtDateRu(robuxUnlockDate(inp.completedAt ?? new Date()));

  const tgMsg1 =
    `✅ <b>Заказ выкуплен!</b> Робуксы уже в пути 🚀\n\n` +
    `Roblox зачислит их до <b>${unlockStr}</b> — это стандартная заморозка «Pending» на их стороне.\n\n` +
    `📊 Проверить: https://www.roblox.com/transactions → строка <b>Pending</b>`;
  const vkMsg1 =
    `✅ Заказ выкуплен! Робуксы уже в пути 🚀\n\n` +
    `Roblox зачислит их до ${unlockStr} — это стандартная заморозка «Pending» на их стороне.\n\n` +
    `📊 Проверить: https://www.roblox.com/transactions → строка Pending`;

  const discountTg = inp.discountGranted ? `\n\n💰 Дарю тебе скидку <b>60 рублей</b> к следующему заказу.` : "";
  const discountVk = inp.discountGranted ? `\n\n💰 Дарю тебе скидку 60 рублей к следующему заказу.` : "";

  // 1. Питч отзыва: WB-заказ, бонуса на балансе нет, код не заклеймлен.
  if (!inp.isDirectOrder && !inp.bonusGrantedAt && inp.codeUnclaimed) {
    const tgMsg2 =
      `🎁 <b>Бонус за отзыв: +100 R$</b> к любому прямому заказу.\n\n` +
      `Как получить:\n` +
      `1. Оставь отзыв на Wildberries — с текстом и фото (только оценка не подойдёт).\n` +
      `2. Пришли скриншот сюда фотографией (не файлом).\n\n` +
      `После проверки начислим сразу. Действует ${BONUS_EXPIRY_DAYS} дней.`;
    return {
      kind: "review_pitch",
      tgMsg1, vkMsg1, tgMsg2,
      vkMsg2: tgMsg2.replace(/<\/?b>/g, ""),
      buttons: [BTN_REVIEW, BTN_DIRECT],
    };
  }

  // 2. Бонус уже на балансе — напомнить потратить.
  if (inp.bonusGrantedAt) {
    const expiresStr = fmtDateRu(new Date(inp.bonusGrantedAt.getTime() + BONUS_EXPIRY_DAYS * 86_400_000));
    const balanceStr = inp.bonusBalance > 0 ? `${inp.bonusBalance} R$` : `+100 R$`;
    const tgMsg2 =
      `🎁 У тебя бонус <b>${balanceStr}</b> — действует до <b>${expiresStr}</b>.\n\n` +
      `Он добавится к любому прямому заказу автоматически (без карточки WB).`;
    return {
      kind: "bonus_reminder",
      tgMsg1, vkMsg1, tgMsg2,
      vkMsg2: tgMsg2.replace(/<\/?b>/g, ""),
      buttons: [BTN_USE_BONUS],
    };
  }

  // 3. Повторный WB-клиент — TIER-2 питч закрытого формата (текст без изменений).
  if (!inp.isDirectOrder && inp.completedCount > 1) {
    const tgMsg2 =
      `Это уже твой <b>${inp.completedCount}-й</b> заказ в RobloxBank. Спасибо за доверие! 💛\n\n` +
      `Кстати, для постоянных клиентов у нас есть закрытый формат. Чтобы не ждать поставок на Wildberries и оформлять заказы по самому выгодному курсу (без лишних комиссий), пиши нам в поддержку напрямую: @RobloxBank_PA\n\n` +
      `Это <b>быстрее, проще и всегда выгоднее</b>. Мы закрепим за тобой персональное обслуживание.\n\n` +
      `Всё ли было удобно в этот раз? Если есть идеи по улучшению — напиши в поддержку, мы читаем каждое сообщение!`;
    const vkMsg2 = tgMsg2.replace(/<\/?b>/g, "").replace("@RobloxBank_PA", "https://t.me/RobloxBank_PA");
    return { kind: "tier2", tgMsg1, vkMsg1, tgMsg2, vkMsg2, buttons: [BTN_DIRECT] };
  }

  // 4. Прямой заказ / остальное — благодарность (+скидка для DIR <500).
  const tgMsg2 = inp.completedCount > 1
    ? `Это уже твой <b>${inp.completedCount}-й</b> заказ — спасибо за доверие! 💛${discountTg}\n\n` +
      `Всё ли было удобно? Напиши нам — мы читаем каждое сообщение.`
    : `Спасибо, что выбрал RobloxBank! Заказывай ещё — мы всегда здесь 💛${discountTg}`;
  const vkMsg2 = inp.completedCount > 1
    ? `Это уже твой ${inp.completedCount}-й заказ — спасибо за доверие! 💛${discountVk}\n\n` +
      `Всё ли было удобно? Напиши нам — мы читаем каждое сообщение.`
    : `Спасибо, что выбрал RobloxBank! Заказывай ещё — мы всегда здесь 💛${discountVk}`;
  return { kind: "thanks", tgMsg1, vkMsg1, tgMsg2, vkMsg2, buttons: [BTN_DIRECT] };
}
