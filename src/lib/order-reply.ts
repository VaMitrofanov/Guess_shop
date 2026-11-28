/**
 * 💬 «Ответ клиенту» из карточки заказа (16.11.2026, редизайн v2). Без базы —
 * импортируется и TWA, и сайтом. Кнопка видна только тем, кто писал в поддержку
 * (`order-contact.ts`).
 */
import { robuxWaitText } from "../../bots/shared/robux-wait";

/**
 * Готовый ответ клиенту под текущее состояние заказа. Без сроков: сроки
 * ожидания робуксов в клиентских текстах не называем (AGENTS.md).
 */
export function replyForOrder(order: {
  status: string;
  heldAt?: string | Date | null;
  robloxUsername?: string | null;
  gamepassUrl?: string | null;
  completedAt?: string | Date | null;
}): string {
  if (order.status === "COMPLETED") {
    // Про срок — только общий текст (feedback: один текст ожидания Pending).
    return `Здравствуйте! Ваш заказ выполнен: геймпасс выкуплен.\n\n${robuxWaitText("vy")}`;
  }
  if (order.status === "REJECTED") {
    return "Здравствуйте! Этот заказ закрыт. Если есть вопрос по нему — напишите, разберёмся.";
  }
  if (order.heldAt) {
    return "Здравствуйте! Мы видим ваше обращение, заказ сейчас на проверке. Вернёмся с ответом, как только разберёмся.";
  }
  if (order.status === "AWAITING_GAMEPASS" || (!order.gamepassUrl && !order.robloxUsername)) {
    return "Здравствуйте! Чтобы мы выкупили робуксы, нужен ваш геймпасс — пришлите, пожалуйста, ссылку на него. Если не получается создать — напишите, поможем.";
  }
  return "Здравствуйте! Ваш заказ в очереди на выкуп, геймпасс проверен — всё в порядке. Как только выкупим, вам придёт уведомление.";
}
