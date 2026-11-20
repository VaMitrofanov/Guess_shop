import { prisma } from "@/lib/prisma";
import { issuedCodesForOrder } from "@/lib/codes/order-codes";
import { codeChatPaidText, codeChatSealedText, codeChatTgKeyboard, CODES_CB, ROBLOX_REDEEM_LINK } from "../../../bots/shared/codes-shop";
import { FLAIR_IMAGE, copyButton, effectExtra, hasCodeImage, isEffectRefusal } from "../../../bots/shared/tg-flair";
import { telegramRequestInit } from "../../../bots/shared/telegram-photo";
import { vkUploadMessagePhoto } from "../../../bots/shared/vk-photo";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Код в чат бота (15.11.2026): заказ, оформленный в TG или ВК, получает код
 * ещё и сообщением туда, где человек его покупал. Шлёт Web — у ботов нет ключа
 * склада, и так ключ живёт в одном месте.
 *
 * Тексты общие с ботами (`bots/shared/codes-shop.ts`). Сообщение уходит один
 * раз (`chatDeliveredAt`); сбой отправки не трогает ни заказ, ни код — код
 * всё равно в кабинете и в повторной отправке.
 */

type TgResult = { ok: boolean; messageId?: number; description?: string };

/**
 * Любой вызов Bot API — через мост (RF-хост не видит Telegram) или напрямую.
 * `photo_base64` уходит multipart (`telegramRequestInit`), мост сам выберет sendPhoto.
 */
async function tgCall(fields: Record<string, unknown>): Promise<TgResult> {
  const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();
  try {
    if (bridgeUrl) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (process.env.VALIDATOR_KEY) headers["x-validator-key"] = process.env.VALIDATOR_KEY;
      const response = await fetch(`${bridgeUrl}/tg-proxy`, { method: "POST", headers, body: JSON.stringify(fields), signal: AbortSignal.timeout(20_000) });
      const json = await response.json().catch(() => null) as { ok?: boolean; delivered?: boolean; result?: { message_id?: number }; description?: string } | null;
      return { ok: response.ok && json?.ok !== false && json?.delivered !== false, messageId: json?.result?.message_id, description: json?.description };
    }
    const { method, chat_id, ...rest } = fields;
    const resolved = typeof method === "string" ? method : rest.photo_base64 ? "sendPhoto" : "sendMessage";
    const response = await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/${resolved}`, {
      ...telegramRequestInit({ ...rest, chat_id }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = await response.json().catch(() => null) as { ok?: boolean; result?: { message_id?: number }; description?: string } | null;
    return { ok: json?.ok === true, messageId: json?.result?.message_id, description: json?.description };
  } catch {
    return { ok: false };
  }
}

/** Картинка из public/brand base64 (null — нет файла: шлём без картинки). */
async function brandPhoto(name: string): Promise<string | null> {
  const bytes = await readFile(path.join(process.cwd(), "public", "brand", name)).catch(() => null);
  return bytes ? bytes.toString("base64") : null;
}

/**
 * Сообщение в TG: с картинкой (подпись) или текстом; эффект 🎉 — если дали.
 * Отказ из-за эффекта → ещё раз без него (`isEffectRefusal`).
 */
async function tgPost(chatId: string, html: string, replyMarkup: unknown, opts: { photo?: string | null; effect?: Record<string, unknown> } = {}): Promise<TgResult> {
  const base: Record<string, unknown> = opts.photo
    ? { chat_id: chatId, photo_base64: opts.photo, caption: html, parse_mode: "HTML", reply_markup: replyMarkup }
    : { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: replyMarkup };
  const first = await tgCall({ ...base, ...(opts.effect ?? {}) });
  if (first.ok || !opts.effect?.message_effect_id || !isEffectRefusal({ description: first.description })) {
    // Картинка не ушла (не эффект) — пробуем текстом: код важнее красоты.
    if (!first.ok && opts.photo) return tgPost(chatId, html, replyMarkup, { effect: opts.effect });
    return first;
  }
  return tgCall(base);
}

async function vkPost(userId: string, message: string, keyboard: unknown, attachment?: string | null): Promise<boolean> {
  const params = new URLSearchParams({
    ...(attachment ? { attachment } : {}),
    user_id: userId,
    message,
    random_id: String(Date.now() + Math.floor(Math.random() * 1000)),
    access_token: process.env.VK_TOKEN ?? "",
    v: "5.131",
    keyboard: JSON.stringify(keyboard),
    dont_parse_links: "1",
  });
  try {
    const response = await fetch("https://api.vk.com/method/messages.send", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await response.json().catch(() => null) as { response?: unknown; error?: unknown } | null;
    return Boolean(json && !json.error && json.response !== undefined);
  } catch {
    return false;
  }
}

function tgKeyboard(issued: boolean, codes: readonly string[] = []) {
  return {
    inline_keyboard: [
      ...(issued ? codes.map((code, index) => [copyButton(codes.length > 1 ? `📋 Скопировать код ${index + 1}` : "📋 Скопировать код", code)]) : []),
      ...(issued ? [[{ text: "🚀 Активировать на Roblox", url: ROBLOX_REDEEM_LINK }]] : []),
      [{ text: "🤝 Скидка за друзей", callback_data: CODES_CB.invite }, { text: "🎟 Ещё код", callback_data: CODES_CB.open }],
    ],
  };
}

function vkKeyboard(issued: boolean, revealId?: string, several = false) {
  return {
    inline: true,
    buttons: [
      ...(revealId ? [[{ action: { type: "text", label: several ? "👁 Показать коды" : "👁 Показать код", payload: JSON.stringify({ command: CODES_CB.reveal(revealId) }) }, color: "positive" }]] : []),
      ...(issued ? [[{ action: { type: "open_link", link: ROBLOX_REDEEM_LINK, label: "🚀 Активировать на Roblox" } }]] : []),
      [
        { action: { type: "text", label: "🤝 Скидка за друзей", payload: JSON.stringify({ command: CODES_CB.invite }) }, color: "secondary" },
        { action: { type: "text", label: "🎟 Ещё код", payload: JSON.stringify({ command: CODES_CB.open }) }, color: "secondary" },
      ],
    ],
  };
}

async function chatTarget(orderId: string) {
  return prisma.codeOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true, channel: true, status: true, denomination: true, publicId: true, chatDeliveredAt: true,
      activationCodeId: true,
      creator: { select: { tgId: true, vkId: true } },
    },
  });
}

const PAID_MESSAGE_EVENT = "CHAT_PAID_MESSAGE";
export const CHAT_SEALED_EVENT = "CHAT_SEALED_SENT";

/** VK: картинка вложением (не загрузилась — без неё) и текст. */
async function vkWithPhoto(vkId: string, plain: string, keyboard: unknown, photoName: string | null): Promise<boolean> {
  const bytes = photoName ? await readFile(path.join(process.cwd(), "public", "brand", photoName)).catch(() => null) : null;
  const attachment = bytes ? await vkUploadMessagePhoto(vkId, bytes) : null;
  return vkPost(vkId, plain, keyboard, attachment);
}

/** Код в чат. null — заказ не из бота (слать некуда). */
export async function sendCodeToChat(orderId: string): Promise<boolean | null> {
  const order = await chatTarget(orderId);
  if (!order || (order.channel !== "TG" && order.channel !== "VK")) return null;
  if (order.status !== "ISSUED" || !order.activationCodeId || order.chatDeliveredAt) return null;
  let codes: string[];
  try {
    codes = await issuedCodesForOrder(order.id);
    if (!codes.length) throw new Error("no issued codes");
  } catch {
    console.error("[codes] chat: cannot decrypt", { orderId: order.id });
    return false;
  }
  // Код уходит запечатанным (21.11.2026): значение — по кнопке «👁 Показать код»,
  // момент открытия видят админы (`/api/internal/codes/reveal`).
  const text = codeChatSealedText({ denomination: order.denomination, publicId: order.publicId, count: codes.length });
  const image = hasCodeImage(order.denomination) ? FLAIR_IMAGE.code(order.denomination) : null;
  let ok: boolean | null = null;
  if (order.channel === "TG" && order.creator?.tgId) {
    const tgId = order.creator.tgId;
    // З2: было «Готовим ваш код» — убираем его, билет приходит на его место.
    const paid = await prisma.codeOrderEvent.findFirst({ where: { orderId: order.id, type: PAID_MESSAGE_EVENT }, select: { payload: true } }).catch(() => null);
    const paidMessageId = Number((paid?.payload as { messageId?: number } | null)?.messageId) || null;
    if (paidMessageId) await tgCall({ method: "deleteMessage", chat_id: tgId, message_id: paidMessageId }).catch(() => undefined);
    const sent = await tgPost(tgId, text.html, codeChatTgKeyboard({ publicId: order.publicId, count: codes.length }), { photo: image ? await brandPhoto(image) : null, effect: effectExtra("party") });
    ok = sent.ok;
  } else if (order.channel === "VK" && order.creator?.vkId) {
    ok = await vkWithPhoto(order.creator.vkId, text.plain, vkKeyboard(true, order.publicId, codes.length > 1), image);
  }
  if (ok) {
    await prisma.codeOrder.update({ where: { id: order.id }, data: { chatDeliveredAt: new Date() } });
    // Метка «в чат ушёл конверт, а не код»: увед об открытии не должен считать
    // доставку в чат моментом, с которого покупатель видел код.
    await prisma.codeOrderEvent.create({
      data: { orderId: order.id, type: CHAT_SEALED_EVENT, idempotencyKey: `code-chat-sealed:${order.id}`, payload: {} },
    }).catch(() => undefined);
  }
  else if (ok === false) console.warn("[codes] chat delivery failed", { order: order.publicId, channel: order.channel });
  return ok;
}

/** Напоминание о неоплаченном заказе из бота: ссылка на оплату кнопкой. */
export async function sendPayReminderToChat(orderId: string, payUrl: string, amountRub: string): Promise<boolean | null> {
  const order = await chatTarget(orderId);
  if (!order || (order.channel !== "TG" && order.channel !== "VK")) return null;
  const amount = order.denomination.toLocaleString("ru-RU");
  const html = `⏳ <b>Код на ${amount} Robux ждёт оплаты</b>\n\nЦена ${amountRub} сохранена. Оплатить можно по кнопке ниже — картой или СБП.`;
  const plain = `⏳ Код на ${amount} Robux ждёт оплаты\n\nЦена ${amountRub} сохранена. Оплатить: ${payUrl}`;
  if (order.channel === "TG" && order.creator?.tgId) {
    return (await tgPost(order.creator.tgId, html, { inline_keyboard: [[{ text: `💳 Оплатить ${amountRub}`, url: payUrl }]] })).ok;
  }
  if (order.channel === "VK" && order.creator?.vkId) {
    return vkPost(order.creator.vkId, plain, { inline: true, buttons: [[{ action: { type: "open_link", link: payUrl, label: `💳 Оплатить ${amountRub}` } }]] });
  }
  return null;
}

/** Ручной режим: «оплата прошла, код пришлём сюда же». */
export async function sendPaidToChat(orderId: string): Promise<boolean | null> {
  const order = await chatTarget(orderId);
  if (!order || (order.channel !== "TG" && order.channel !== "VK") || order.status !== "PAID") return null;
  const text = codeChatPaidText({ denomination: order.denomination, publicId: order.publicId });
  // З2: картинка «Готовим ваш код»; её message_id запоминаем — при выдаче кода
  // сообщение удаляется, и на его месте приходит билет с конфетти.
  if (order.channel === "TG" && order.creator?.tgId) {
    const sent = await tgPost(order.creator.tgId, text.html, tgKeyboard(false), { photo: await brandPhoto(FLAIR_IMAGE.codePreparing) });
    if (sent.ok && sent.messageId) {
      await prisma.codeOrderEvent.create({
        data: { orderId: order.id, type: PAID_MESSAGE_EVENT, idempotencyKey: `chat-paid:${order.id}`, payload: { messageId: sent.messageId } },
      }).catch(() => undefined);
    }
    return sent.ok;
  }
  if (order.channel === "VK" && order.creator?.vkId) return vkWithPhoto(order.creator.vkId, text.plain, vkKeyboard(false), FLAIR_IMAGE.codePreparing);
  return null;
}
