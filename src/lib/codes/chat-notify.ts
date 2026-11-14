import { prisma } from "@/lib/prisma";
import { decryptActivationCode } from "@/lib/codes/secrets";
import { codeChatIssuedText, codeChatPaidText, CODES_CB, ROBLOX_REDEEM_LINK } from "../../../bots/shared/codes-shop";

/**
 * Код в чат бота (15.11.2026): заказ, оформленный в TG или ВК, получает код
 * ещё и сообщением туда, где человек его покупал. Шлёт Web — у ботов нет ключа
 * склада, и так ключ живёт в одном месте.
 *
 * Тексты общие с ботами (`bots/shared/codes-shop.ts`). Сообщение уходит один
 * раз (`chatDeliveredAt`); сбой отправки не трогает ни заказ, ни код — код
 * всё равно в кабинете и в повторной отправке.
 */

async function tgPost(chatId: string, text: string, replyMarkup: unknown): Promise<boolean> {
  const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();
  const payload = {
    token: process.env.TG_TOKEN,
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
  };
  try {
    if (bridgeUrl) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (process.env.VALIDATOR_KEY) headers["x-validator-key"] = process.env.VALIDATOR_KEY;
      const response = await fetch(`${bridgeUrl}/tg-proxy`, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
      const json = await response.json().catch(() => null) as { ok?: boolean; delivered?: boolean } | null;
      return response.ok && json?.ok !== false && json?.delivered !== false;
    }
    const response = await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await response.json().catch(() => null) as { ok?: boolean } | null;
    return json?.ok === true;
  } catch {
    return false;
  }
}

async function vkPost(userId: string, message: string, keyboard: unknown): Promise<boolean> {
  const params = new URLSearchParams({
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

function tgKeyboard(issued: boolean) {
  return {
    inline_keyboard: [
      ...(issued ? [[{ text: "🚀 Активировать на Roblox", url: ROBLOX_REDEEM_LINK }]] : []),
      [{ text: "🤝 Скидка за друзей", callback_data: CODES_CB.invite }, { text: "🎟 Ещё код", callback_data: CODES_CB.open }],
    ],
  };
}

function vkKeyboard(issued: boolean) {
  return {
    inline: true,
    buttons: [
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
      activationCode: { select: { encryptedValue: true } },
      creator: { select: { tgId: true, vkId: true } },
    },
  });
}

async function send(channel: string, creator: { tgId: string | null; vkId: string | null } | null, html: string, plain: string, issued: boolean): Promise<boolean | null> {
  if (channel === "TG" && creator?.tgId) return tgPost(creator.tgId, html, tgKeyboard(issued));
  if (channel === "VK" && creator?.vkId) return vkPost(creator.vkId, plain, vkKeyboard(issued));
  return null;
}

/** Код в чат. null — заказ не из бота (слать некуда). */
export async function sendCodeToChat(orderId: string): Promise<boolean | null> {
  const order = await chatTarget(orderId);
  if (!order || (order.channel !== "TG" && order.channel !== "VK")) return null;
  if (order.status !== "ISSUED" || !order.activationCode || order.chatDeliveredAt) return null;
  let code: string;
  try {
    code = decryptActivationCode(order.activationCode.encryptedValue);
  } catch {
    console.error("[codes] chat: cannot decrypt", { orderId: order.id });
    return false;
  }
  const text = codeChatIssuedText({ denomination: order.denomination, code, publicId: order.publicId });
  const ok = await send(order.channel, order.creator, text.html, text.plain, true);
  if (ok) await prisma.codeOrder.update({ where: { id: order.id }, data: { chatDeliveredAt: new Date() } });
  else if (ok === false) console.warn("[codes] chat delivery failed", { order: order.publicId, channel: order.channel });
  return ok;
}

/** Ручной режим: «оплата прошла, код пришлём сюда же». */
export async function sendPaidToChat(orderId: string): Promise<boolean | null> {
  const order = await chatTarget(orderId);
  if (!order || (order.channel !== "TG" && order.channel !== "VK") || order.status !== "PAID") return null;
  const text = codeChatPaidText({ denomination: order.denomination, publicId: order.publicId });
  return send(order.channel, order.creator, text.html, text.plain, false);
}
