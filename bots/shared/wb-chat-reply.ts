/* ─────────────────────────────────────────────────────────────────────────────
   💬 Ответ покупателю WB прямо из Telegram (15.11.2026, владелец: «эргономика,
   меньше переключений»).

   Под уведом «покупатель пишет» — готовые ответы кнопками (инструкция, «пришлите
   код доставки», «курьера нет») и «✍️ Свой ответ»: админ отвечает на увед в
   Telegram, бот пересылает текст в чат WB. Под уведом остаётся отметка, кто
   ответил, — чтобы двое не писали одно и то же.

   Отправка — тот же путь, что у бота (`sendBuyerChatMessage` → `wbChatSafeText`),
   плюс зеркало в ленту чата (`local:outbound:*`), как у консоли DBS.
   Связь «сообщение в Telegram → заказ» — в `WbSyncCursor` `wb-reply-map`.
   ───────────────────────────────────────────────────────────────────────── */

import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { sendBuyerChatMessage } from "./wb-delivery-api";
import { containsSecretToken, decryptWbSecret, redactWbChatText, wbDeliveryCryptoReady } from "./wb-delivery-crypto";
import { resolveWbOrderChat } from "./wb-order-chat";
import { wbChatSafeText, wbCodeRequestMessage, wbGateShortUrl, wbGuideFallbackUrl } from "./wb-gate-link";
import { courierReplyText } from "./wb-courier-reply";
import type { WbReplyKind } from "./wb-reply-buttons";

type Db = Pick<PrismaClient, "wbMarketplaceOrder" | "wbBuyerChat" | "wbBuyerChatEvent" | "wbMarketplaceEvent">;
export { parseWbReplyCallback, wbOrderForMessage } from "./wb-reply-buttons";

/** Готовый текст по кнопке. Инструкция — личная ссылка, если гейт уже выдан, иначе просим код. */
export async function wbReplyTemplate(db: Db, wbOrderId: string, kind: Exclude<WbReplyKind, "w">): Promise<string> {
  if (kind === "c") return wbCodeRequestMessage();
  if (kind === "r") return courierReplyText();
  const order = await db.wbMarketplaceOrder.findUnique({ where: { wbOrderId }, select: { wbCode: { select: { code: true } }, completedAt: true } });
  const code = order?.wbCode?.code;
  if (!code) {
    return `Здравствуйте! Инструкция придёт сюда сразу после кода доставки.\n\n${wbCodeRequestMessage()}`;
  }
  return [
    "Здравствуйте! Вот ваша инструкция — по шагам, код уже подставлен:",
    wbGateShortUrl(code),
    `Если ссылка не открылась, перейдите на ${wbGuideFallbackUrl()} и введите код: ${code}`,
  ].join("\n\n");
}

export type WbReplyResult = { sent: true } | { sent: false; reason: "disabled" | "no_order" | "no_chat" | "cancelled" | "send_failed" | "secret" };

/** Отправить текст в чат WB заказа и положить зеркало в ленту чата. */
export async function sendWbChatReply(db: Db, wbOrderId: string, rawText: string, actor: string): Promise<WbReplyResult> {
  if (process.env.WB_CHAT_SEND_ENABLED !== "true" || !wbDeliveryCryptoReady()) return { sent: false, reason: "disabled" };
  // 🔐 Ключ API в чат WB не уходит (16.11.2026): переписка WB чужая, её видят
  // поддержка WB и все, кто откроет чат. Ключ покупателя вставляют в карточке
  // заказа («🔑 Ключ покупателя») — пасс мы создадим сами.
  if (containsSecretToken(rawText)) return { sent: false, reason: "secret" };
  const order = await db.wbMarketplaceOrder.findUnique({
    where: { wbOrderId },
    select: {
      id: true, orderUid: true, isTest: true, cancelledAt: true,
      chats: { select: { chatId: true, replySignEncrypted: true }, orderBy: { lastEventAt: "desc" }, take: 1 },
    },
  });
  if (!order) return { sent: false, reason: "no_order" };
  if (order.cancelledAt) return { sent: false, reason: "cancelled" };
  const chat = await resolveWbOrderChat(db, order);
  if (!chat) return { sent: false, reason: "no_chat" };
  const text = wbChatSafeText(rawText.trim());
  try {
    await sendBuyerChatMessage(decryptWbSecret(chat.replySignEncrypted, "reply-sign"), text);
  } catch (error) {
    console.warn("[wb-chat-reply] WB не принял:", (error as Error)?.message ?? error);
    return { sent: false, reason: "send_failed" };
  }
  const sentAt = new Date();
  await db.wbBuyerChatEvent.create({
    data: {
      wbEventId: `local:outbound:${crypto.randomUUID()}`,
      chatId: chat.chatId,
      marketplaceOrderId: order.id,
      eventType: "message",
      sender: "seller",
      textRedacted: redactWbChatText(text),
      sentAt,
      attachmentsMeta: { pendingProviderEcho: true, via: "tg-reply" },
    },
  }).catch(() => undefined);
  await db.wbMarketplaceEvent.create({
    data: {
      marketplaceOrderId: order.id,
      type: "TG_REPLY_SENT",
      idempotencyKey: `tg-reply:${order.id}:${sentAt.getTime()}`,
      actor: actor.slice(0, 60),
      payload: { length: text.length },
    },
  }).catch(() => undefined);
  return { sent: true };
}

export function wbReplyFailText(reason: Exclude<WbReplyResult, { sent: true }>["reason"]): string {
  return {
    disabled: "отправка в чат WB выключена",
    no_order: "заказ WB не найден",
    no_chat: "у заказа ещё нет чата WB",
    cancelled: "заказ отменён — писать некуда",
    send_failed: "WB не принял сообщение",
    secret: "похоже на ключ API — в чат WB его не шлём; вставьте ключ в карточке заказа «🔑 Ключ покупателя»",
  }[reason];
}
