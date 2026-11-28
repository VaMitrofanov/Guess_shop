import type { PrismaClient } from "@prisma/client";
import { classifyBuyerMessage } from "./buyer-contact";
import type { WbAutoReceiveSignals } from "./wb-delivery-policy";

/* ─────────────────────────────────────────────────────────────────────────────
   Тревожные сигналы заказа DBS для автозакрытия за окном 4 ч (21.11.2026).

   Отдельный модуль: им пользуются и воркер (`wb-delivery-sync`), и режим отмены
   (`wb-cancel-mode`), а они импортируют друг друга. Решение «придержать» воркер
   пишет в аудит событием `AUTO_RECEIVE_HELD` — по нему карточка и алерт
   «доставка висит» понимают, что заказ ждёт человека намеренно.
   ───────────────────────────────────────────────────────────────────────── */

export const AUTO_RECEIVE_HELD = "AUTO_RECEIVE_HELD";

export async function loadAutoReceiveSignals(db: PrismaClient, orderId: string): Promise<WbAutoReceiveSignals> {
  const order = await db.wbMarketplaceOrder.findUnique({
    where: { id: orderId },
    select: { denominationSnapshot: true, claimOpenedAt: true, claimResolvedAt: true },
  });
  const messages = await db.wbBuyerChatEvent.findMany({
    where: { marketplaceOrderId: orderId, sender: "client", eventType: "message", textRedacted: { not: null } },
    select: { textRedacted: true },
    orderBy: { sentAt: "desc" },
    take: 50,
  });
  return {
    corridor: Boolean(order?.denominationSnapshot),
    claimOpen: Boolean(order?.claimOpenedAt && !order.claimResolvedAt),
    buyerAskedCancel: messages.some((m) => classifyBuyerMessage(m.textRedacted) === "cancel"),
  };
}

/** Заказ придержан для человека — по аудиту. */
export function autoReceiveHeld(events: Array<{ type: string }>): boolean {
  return events.some((event) => event.type === AUTO_RECEIVE_HELD);
}

/** Ответ покупателю, когда код принят, а доставку сразу не закрыли. Без сроков. */
export function deliveryCodeAckText(): string {
  return "Спасибо, код доставки получили ✅\n\nПроверяем заказ — код активации пришлём сюда, в этот чат. Больше ничего отправлять не нужно.";
}
