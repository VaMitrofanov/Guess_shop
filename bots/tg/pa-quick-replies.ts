/* ─────────────────────────────────────────────────────────────────────────────
   Быстрые ответы Telegram Business на @RobloxBank_PA (13.11.2026).

   Оператор набирает `/` в чате с покупателем и выбирает готовый текст. Воркер
   только ДОБАВЛЯЕТ недостающие ярлыки из `PA_QUICK_REPLIES`; существующие (в том
   числе с тем же именем) не правит и не удаляет. Тексты на «вы» — так пишет оператор.

   Писать в чаты покупателей воркер по-прежнему не может: быстрый ответ — это
   сообщение в служебном списке аккаунта, покупатель его не видит, пока
   оператор сам не отправит.
   ───────────────────────────────────────────────────────────────────────── */

import { Api, type TelegramClient } from "telegram";
import { generateRandomLong } from "telegram/Helpers";
import { robuxWaitText } from "../shared/robux-wait";

const priceOf = (amount: number) => Math.ceil(amount / 0.7);
const PRICE_EXAMPLES = [100, 200, 300, 500, 800, 1000, 1500, 2000];

/** Ярлык (латиница, без `/`) → текст. Порядок = порядок в списке Telegram. */
/**
 * Ярлык → текст. 13.11.2026: у оператора уже 18 своих ярлыков (/pending, /код,
 * /idгеймпасс, /выкуп…), поэтому здесь — только то, чего у него нет.
 */
export const PA_QUICK_REPLIES: Array<{ shortcut: string; text: string }> = [
  {
    shortcut: "цена",
    text:
      "Цена геймпасса = номинал ÷ 0,7 с округлением вверх (Roblox забирает 30%):\n" +
      PRICE_EXAMPLES.map((a) => `${a} R$ → ${priceOf(a)} R$`).join("\n") +
      "\n\nТочная цена — в карточке заказа в боте @RobloxBankBot.",
  },
  {
    shortcut: "managed",
    text:
      "Проверьте, пожалуйста, что у геймпасса выключен Managed pricing (региональные цены). Если он включён, Roblox сам меняет цену, и мы не сможем выкупить пасс.\n\n" +
      "Где: Passes → ваш пасс → ☰ → Sales → Managed pricing = OFF → Save Changes.",
  },
  {
    // 15.11.2026, владелец: «заебался писать про задержки» — «выкупили N-го, а робуксов нет».
    shortcut: "задержка",
    text:
      "Понимаем, ждать неприятно 🙏 С нашей стороны заказ выполнен: геймпасс выкуплен, робуксы сейчас в статусе ожидания (Pending).\n\n" +
      robuxWaitText("vy") + "\n\n" +
      "Как проверить: roblox.com → значок Robux → «Мои транзакции» → строка «Робуксы в ожидании» (Pending Robux). Если там есть сумма — всё в порядке: Roblox сам переведёт её на баланс, ничего делать не нужно.\n\n" +
      "Ускорить это не можем ни мы, ни поддержка Roblox, но робуксы никуда не пропадут.",
  },
  {
    shortcut: "бот",
    text: "Все шаги и статус заказа — в боте @RobloxBankBot: кнопки «📖 Инструкция» и «📊 Мой заказ». Там же придёт уведомление о выкупе.",
  },
];

export interface QuickReplySyncResult { created: number; updated: number; same: number }

/**
 * Создать недостающие ярлыки. Существующие НЕ трогаем никогда: ярлык с тем же
 * именем мог завести и править оператор (так было с /pending 13.11.2026).
 */
export async function syncPaQuickReplies(tg: TelegramClient, dry = false): Promise<QuickReplySyncResult> {
  const res: QuickReplySyncResult = { created: 0, updated: 0, same: 0 };
  const all = await tg.invoke(new Api.messages.GetQuickReplies({ hash: 0 as never }));
  const names = new Set(("quickReplies" in all ? all.quickReplies : []).map((q) => q.shortcut.toLowerCase()));
  for (const want of PA_QUICK_REPLIES) {
    if (names.has(want.shortcut.toLowerCase())) { res.same++; continue; }
    res.created++;
    if (dry) { console.log(`[pa-quick] (dry) создать /${want.shortcut}`); continue; }
    await tg.invoke(new Api.messages.SendMessage({
      peer: new Api.InputPeerSelf(),
      message: want.text,
      randomId: generateRandomLong(),
      noWebpage: true,
      quickReplyShortcut: new Api.InputQuickReplyShortcut({ shortcut: want.shortcut }),
    }));
    await new Promise((r) => setTimeout(r, 1500));
  }
  return res;
}
