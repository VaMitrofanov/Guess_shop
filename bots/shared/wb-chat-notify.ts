import type { PrismaClient } from "@prisma/client";
import { sendBuyerChatMessage } from "./wb-delivery-api";
import { decryptWbSecret, wbDeliveryCryptoReady } from "./wb-delivery-crypto";

/* ─────────────────────────────────────────────────────────────────────────────
   Чат Wildberries как запасной канал до покупателя DBS.

   Замер 11.09.2026: из 151 VK-покупателя за 30 дней 37 не разрешили сообществу
   писать — и 17 закрытых заказов остались без единого слова о выкупе. При этом
   чат WB у тех же людей работает безупречно: именно им пришла ссылка на гейт,
   именно там они прислали код доставки.

   Хуже того, до сих пор мы этот канал сами и гасили: напоминания по гейту
   (`wb-delivery-sync`) прекращаются в ту секунду, когда покупатель активирует
   код, — то есть ровно тогда, когда общение переезжает в канал с доставкой 75 %.

   Здесь — узкая дверь обратно: сказать человеку то, чего он иначе не узнает.
   Не подмена ботов, а последний рубеж, когда бот уже промолчал.
   ───────────────────────────────────────────────────────────────────────── */

type Db = Pick<PrismaClient, "wbMarketplaceOrder">;

export type WbChatNoticeResult =
  | { sent: true }
  | { sent: false; reason: "disabled" | "no_crypto" | "not_dbs" | "no_chat" | "cancelled" | "send_failed" };

/**
 * Написать покупателю в чат WB по коду гейта.
 *
 * Возвращает причину отказа, а не бросает: вызывающий — путь уведомления о
 * выкупе, и он не имеет права падать из-за того, что письмо не ушло.
 */
export async function notifyBuyerViaWbChat(
  db: Db,
  wbCode: string,
  message: string,
): Promise<WbChatNoticeResult> {
  if (process.env.WB_CHAT_SEND_ENABLED !== "true") return { sent: false, reason: "disabled" };
  if (!wbDeliveryCryptoReady()) return { sent: false, reason: "no_crypto" };

  const order = await db.wbMarketplaceOrder.findFirst({
    where: { wbCode: { code: wbCode }, isTest: false },
    orderBy: { firstSeenAt: "desc" },
    select: {
      cancelledAt: true,
      chats: { select: { replySignEncrypted: true }, take: 1 },
    },
  }).catch(() => null);

  if (!order) return { sent: false, reason: "not_dbs" };
  // Отменённый заказ — деньги вернулись; писать «заказ выкуплен» туда нельзя.
  if (order.cancelledAt) return { sent: false, reason: "cancelled" };
  const replySign = order.chats?.[0]?.replySignEncrypted;
  if (!replySign) return { sent: false, reason: "no_chat" };

  try {
    await sendBuyerChatMessage(decryptWbSecret(replySign, "reply-sign"), message);
    return { sent: true };
  } catch (error) {
    console.warn("[wb-chat-notify] WB не принял сообщение:", (error as Error)?.message ?? error);
    return { sent: false, reason: "send_failed" };
  }
}

/**
 * Текст «заказ выкуплен» для чата WB: без HTML, без кнопок, без ссылок на
 * сторонние площадки — WB их не любит, а человеку нужен сам факт.
 *
 * Про заморозку Pending говорим по-разному в зависимости от того, сколько
 * прошло: «подождите пять дней» через три недели после выкупа — это не забота,
 * а издевательство, и человек справедливо прочтёт его как отписку.
 */
export function wbChatCompletedMessage(
  amount: number,
  nick: string | null,
  completedAt?: Date | null,
): string {
  const who = nick ? ` на ник ${nick}` : "";
  const daysPassed = completedAt
    ? Math.floor((Date.now() - completedAt.getTime()) / 86_400_000)
    : 0;
  const pending = daysPassed >= 5
    ? `Robux приходят в Roblox со статусом Pending и разблокируются примерно за 5 дней — ` +
      `с момента выкупа прошло больше, так что они уже должны быть доступны.`
    : `Robux приходят в Roblox со статусом Pending и становятся доступны примерно через 5 дней — ` +
      `это правило Roblox, а не задержка с нашей стороны.`;
  return (
    `Ваш заказ выполнен: ${amount} R$${who} отправлены через геймпасс.\n\n` +
    `${pending}\n\n` +
    `Проверить можно в Roblox: раздел Transactions, строка Pending.\n\n` +
    `Если робуксы не появились — напишите сюда, разберёмся.`
  );
}
