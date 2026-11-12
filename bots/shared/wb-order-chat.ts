import type { PrismaClient } from "@prisma/client";

/* ─────────────────────────────────────────────────────────────────────────────
   Чат WB заказа — или чат его покупки (12.11.2026).

   Код писался в расчёте на то, что WB заводит на каждую карточку корзины свой
   чат. Это не так: 11.11 покупательница взяла две карточки по 500 R$ одной
   покупкой, и чат у WB оказался ОДИН («Чат один» — её слова). Доставку по
   обоим заказам закрыл её код, а ссылку на второй заказ выдача не отправила:
   у него не было своего чата, и выдача молча выходила. Так же с октября стояли
   ещё два заказа (6107415702, 6078220950) — покупательницам сказали, что
   второго заказа «нет».

   Поэтому: свой чат — если он есть; иначе — самый свежий чат соседнего заказа
   той же покупки (`orderUid`). Покупатель один и тот же, чат его.
   ───────────────────────────────────────────────────────────────────────── */

type Db = Pick<PrismaClient, "wbBuyerChat">;

export type WbOrderChat = {
  chatId: string;
  replySignEncrypted: string;
  /** Чат чужой, соседнего заказа той же покупки: текст должен назвать заказ. */
  shared: boolean;
};

type OwnChat = { chatId: string; replySignEncrypted: string | null };

export async function resolveWbOrderChat(
  db: Db,
  order: { id: string; orderUid: string | null; isTest: boolean; chats?: OwnChat[] | null },
): Promise<WbOrderChat | null> {
  const own = order.chats?.find((chat) => chat.replySignEncrypted);
  if (own?.replySignEncrypted) return { chatId: own.chatId, replySignEncrypted: own.replySignEncrypted, shared: false };
  if (!order.orderUid) return null;
  const sibling = await db.wbBuyerChat.findFirst({
    where: {
      replySignEncrypted: { not: null },
      marketplaceOrder: { is: { orderUid: order.orderUid, isTest: order.isTest, id: { not: order.id } } },
    },
    orderBy: { lastEventAt: { sort: "desc", nulls: "last" } },
    select: { chatId: true, replySignEncrypted: true },
  }).catch(() => null);
  if (!sibling?.replySignEncrypted) return null;
  return { chatId: sibling.chatId, replySignEncrypted: sibling.replySignEncrypted, shared: true };
}
