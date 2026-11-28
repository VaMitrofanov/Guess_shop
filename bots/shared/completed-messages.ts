/**
 * Ф5 (2026-07-12): уведомление о выкупе = ДВА сообщения.
 *
 *  • msg1 — операционное (всем, всегда): факт выкупа + «с нашей стороны всё,
 *    дальше Pending у Roblox» + как проверить. Без срока (26.10.2026). Никакого маркетинга.
 *  • msg2 — бонусное (отдельным сообщением сразу после), по приоритету:
 *      1. WB-заказ, бонус не на балансе, код не заклеймлен → питч отзыва,
 *         кнопки [📸 Прислать отзыв] [💎 Купить напрямую] (О2);
 *      2. бонус на балансе → «у тебя бонус N R$ до {дата}» + [💎 Использовать бонус];
 *      3. повторный WB-клиент → TIER-2 питч закрытого формата (без изменений);
 *      4. прямой заказ → «спасибо/N-й заказ» (+скидка 60 ₽, если её начислила
 *         политика bots/shared/direct-discount.ts — один раз за всё время).
 *
 * Кнопки TG и VK одинаковые по названию и действию (TG callback = VK payload
 * command: review_hint / start_direct).
 *
 * Модуль используется notifyUserCompleted (bots/tg/handlers.ts); зеркало для
 * Next-роутов — src/lib/twa-notify.ts (bots/ и src/ не импортируют друг друга,
 * менять СИНХРОННО).
 */

/* Тексты про Pending — в `robux-eta`. `fmtDateRu` реэкспортируется под старым
   именем для остальных модулей ботов. */
import { fmtDateRu, PENDING_INFO_URL, ROBUX_CONFIRM, confirmHintLine } from "./robux-eta";
import { robuxWaitText } from "./robux-wait";
export { fmtDateRu };

export type CompletedButton = {
  label: string;
  /** TG callback_data и VK payload.command — одинаковые строки. */
  command: "review_hint" | "start_direct" | "codes";
};

export interface CompletedMessagesInput {
  isDirectOrder: boolean;
  /** Все COMPLETED-заказы юзера (включая этот). */
  completedCount: number;
  /** Номинал заказа — столько должно стоять в Pending Robux (24.10.2026). */
  amount?: number | null;
  /** Момент выкупа (WbOrder.completedAt); null у легаси-путей → сейчас. */
  completedAt: Date | null;
  /** user.reviewBonusGrantedAt — бонус сейчас на балансе (крон обнуляет по истечении). */
  bonusGrantedAt: Date | null;
  /** user.balance (R$ бонуса). */
  bonusBalance: number;
  /** WbCode этого заказа существует и reviewBonusClaimed=false (WB-код, отзыв ещё не оплачен). */
  codeUnclaimed: boolean;
  /** Скидка 60 ₽ действительно начислена этим завершением (решение принимает
   *  `bots/shared/direct-discount.ts`, начисление — там же). Ровно один раз за
   *  всё время, поэтому текст «дарю скидку» больше не может повториться. */
  discountGranted: boolean;
  /** Ник Roblox заказа — в подписи «выкуплены на ник …» (З3, 18.11.2026). */
  nick?: string | null;
}

/** Кнопка под первым сообщением (о выкупе) — «✅ Робуксы поступили», 27.10.2026. */
export const COMPLETED_MSG1_BUTTON = ROBUX_CONFIRM;

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

/**
 * 🎉 З3 (18.11.2026): «выкуплено» = картинка `order-done.jpg` (плашки этапов
 * нарисованы в ней) + эта подпись + кнопки `completedMsg1Keyboard`. Ссылки —
 * кнопками, единый текст про ожидание (`robuxWaitText`) — в сворачиваемой
 * цитате: видна одна строка, раскрывается касанием. Подпись ≤ 1024 символов.
 */
export const COMPLETED_IMAGE = "order-done.jpg";
export const ROBLOX_TRANSACTIONS = "https://www.roblox.com/transactions";

/** Кнопки под «выкуплено» в TG: проверить, почему так, «✅ Робуксы поступили». */
export function completedMsg1Keyboard() {
  return {
    inline_keyboard: [
      [{ text: "📊 Проверить Pending", url: ROBLOX_TRANSACTIONS }, { text: "📖 Почему так", url: PENDING_INFO_URL }],
      [{ text: ROBUX_CONFIRM.label, callback_data: ROBUX_CONFIRM.command }],
    ],
  };
}

const BTN_REVIEW: CompletedButton = { label: "📸 Прислать отзыв", command: "review_hint" };
const BTN_DIRECT: CompletedButton = { label: "💎 Купить напрямую", command: "start_direct" };
const BTN_USE_BONUS: CompletedButton = { label: "💎 Использовать бонус", command: "start_direct" };

const BONUS_EXPIRY_DAYS = 30; // = REVIEW_BONUS_EXPIRY_DAYS (review-eligibility.ts)

/* ⚡ Допродажа кодов после выкупа (19.11.2026, владелец): человек только что
   узнал про Pending — самое время сказать, что можно без него. Код Roblox
   вводится на roblox.com/redeem, Robux сразу на балансе. Срок Pending не
   называем (правило 26.10). Кнопка открывает витрину кодов в боте. */
const BTN_CODES: CompletedButton = { label: "⚡ Коды — без ожидания", command: "codes" };
export const CODES_UPSELL_TG =
  `⚡ <b>Не хотите ждать Pending в следующий раз?</b> Возьмите код Roblox: оплатили — код пришёл сюда в чат, ` +
  `ввели на roblox.com/redeem — и Robux сразу на балансе. Без геймпасса и без заморозки.`;
export const CODES_UPSELL_PLAIN = CODES_UPSELL_TG.replace(/<\/?b>/g, "");
const withUpsell = (m: CompletedMessages): CompletedMessages => ({
  ...m,
  tgMsg2: `${m.tgMsg2}\n\n${CODES_UPSELL_TG}`,
  vkMsg2: `${m.vkMsg2}\n\n${CODES_UPSELL_PLAIN}`,
  buttons: [...m.buttons, BTN_CODES],
});

export function buildCompletedMessages(inp: CompletedMessagesInput): CompletedMessages {
  return withUpsell(buildCompletedMessagesBase(inp));
}

function buildCompletedMessagesBase(inp: CompletedMessagesInput): CompletedMessages {
  /* С 26.10.2026 — без срока и даты: Roblox стал держать Pending дольше 7 дней,
     и названный срок рождал обращения. Мысль одна: с нашей стороны всё. */
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const amountStr = inp.amount ? `${inp.amount.toLocaleString("ru-RU")} Robux` : "Robux";
  const nickHtml = inp.nick ? ` на ник <code>${esc(inp.nick)}</code>` : "";
  const nickPlain = inp.nick ? ` на ник ${inp.nick}` : "";
  const tgMsg1 =
    `✅ <b>${amountStr} выкуплены</b>${nickHtml}\n\n` +
    `<b>С нашей стороны всё сделано:</b> робуксы уже в Roblox, в статусе <b>Pending</b>. В истории транзакций — строка Pending Robux (Ожидание робуксов), там будет число не меньше ${inp.amount ?? "суммы заказа"}.\n` +
    `<blockquote expandable>⏳ ${robuxWaitText("vy")}</blockquote>\n` +
    confirmHintLine("html");
  const vkMsg1 =
    `✅ ${amountStr} выкуплены${nickPlain}\n\n` +
    `С нашей стороны всё сделано: робуксы уже в Roblox, в статусе Pending. ${robuxWaitText("vy")}\n\n` +
    `📊 Проверить: ${ROBLOX_TRANSACTIONS} → строка Pending Robux (Ожидание робуксов), там будет число не меньше ${inp.amount ?? "суммы заказа"}\n` +
    `⚠️ Страница открывается только в браузере — в приложении Roblox её нет\n` +
    `📖 Почему так: ${PENDING_INFO_URL}\n\n` +
    confirmHintLine("plain");

  const discountTg = inp.discountGranted ? `\n\n💰 Дарю вам скидку <b>60 рублей</b> к следующему заказу.` : "";
  const discountVk = inp.discountGranted ? `\n\n💰 Дарю вам скидку 60 рублей к следующему заказу.` : "";

  // 1. Питч отзыва: WB-заказ, бонуса на балансе нет, код не заклеймлен.
  if (!inp.isDirectOrder && !inp.bonusGrantedAt && inp.codeUnclaimed) {
    const tgMsg2 =
      `🎁 <b>Бонус за отзыв: +100 R$</b> к следующей прямой покупке в RobloxBank.\n\n` +
      `Как получить:\n` +
      `1. Оставьте отзыв на Wildberries — с текстом и фото (только оценка не подойдёт).\n` +
      `2. Пришлите скриншот сюда фотографией (не файлом).\n\n` +
      `После проверки бонус появится на балансе на ${BONUS_EXPIRY_DAYS} дней. Отдельно 100 R$ не выдаются и к покупке на WB не добавляются: оформите следующий прямой заказ в боте или на robloxbank.ru.`;
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
      `🎁 У вас бонус <b>${balanceStr}</b> — действует до <b>${expiresStr}</b>.\n\n` +
      `Он автоматически добавится к следующей прямой покупке в боте или на robloxbank.ru; к покупке на WB бонус не применяется.`;
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
      `Это уже ваш <b>${inp.completedCount}-й</b> заказ в RobloxBank. Спасибо за доверие! 💛\n\n` +
      `Кстати, для постоянных клиентов у нас есть закрытый формат. Чтобы не ждать поставок на Wildberries и оформлять заказы по самому выгодному курсу (без лишних комиссий), пишите нам в поддержку напрямую: @RobloxBank_PA\n\n` +
      `Это <b>быстрее, проще и всегда выгоднее</b>. Мы закрепим за вами персональное обслуживание.\n\n` +
      `Всё ли было удобно в этот раз? Если есть идеи по улучшению — напишите в поддержку, мы читаем каждое сообщение!`;
    const vkMsg2 = tgMsg2.replace(/<\/?b>/g, "").replace("@RobloxBank_PA", "https://t.me/RobloxBank_PA");
    return { kind: "tier2", tgMsg1, vkMsg1, tgMsg2, vkMsg2, buttons: [BTN_DIRECT] };
  }

  // 4. Прямой заказ / остальное — благодарность (+скидка для DIR <500).
  const tgMsg2 = inp.completedCount > 1
    ? `Это уже ваш <b>${inp.completedCount}-й</b> заказ — спасибо за доверие! 💛${discountTg}\n\n` +
      `Всё ли было удобно? Напишите нам — мы читаем каждое сообщение.`
    : `Спасибо, что выбрали RobloxBank! Заказывайте ещё — мы всегда здесь 💛${discountTg}`;
  const vkMsg2 = inp.completedCount > 1
    ? `Это уже ваш ${inp.completedCount}-й заказ — спасибо за доверие! 💛${discountVk}\n\n` +
      `Всё ли было удобно? Напишите нам — мы читаем каждое сообщение.`
    : `Спасибо, что выбрали RobloxBank! Заказывайте ещё — мы всегда здесь 💛${discountVk}`;
  return { kind: "thanks", tgMsg1, vkMsg1, tgMsg2, vkMsg2, buttons: [BTN_DIRECT] };
}
