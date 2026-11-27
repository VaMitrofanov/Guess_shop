/* ─────────────────────────────────────────────────────────────────────────────
   Геймпасс, присланный в поддержку @RobloxBank_PA (17.11.2026).

   Владелец: «нужно сделать автоматическую привязку id gamepass, если её в
   саппорт кинут, чтобы вручную не привязывать».

   Покупатель (или аккаунт, подключённый к его заказу) присылает ссылку на пасс
   или голый ID. Если у него есть заказ, ждущий пасс, — проверяем пасс у Roblox
   теми же правилами, что для чата WB (`attachGamepassFromSupport`), ставим в
   заказ, отвечаем в чате и шлём обычную карточку выкупа с плашкой «пасс из
   поддержки». Неподходящий пасс: цену и «не в продаже» говорим покупателю сами,
   спорное (чужой ник, пасс уже в другом заказе) — только оператору.
   ───────────────────────────────────────────────────────────────────────── */

import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { escapeHtml } from "../shared/notify";
import { attachGamepassFromSupport, findGamepassRefInChatText, splitProgressText } from "../shared/wb-chat-gamepass";
import { pinPaOrdersNow } from "./pa-desk-worker";
import { card } from "./pa-ai";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = (method: string, payload: Record<string, unknown>) => Promise<any>;

/** `true` — сообщение обработано (ответили покупателю). */
export async function attachPassFromSupport(bot: Telegraf, api: Api, m: {
  connId: string; chatId: number; messageId: number; fromId: number; fromName: string; text: string;
}): Promise<boolean> {
  const gamepassId = findGamepassRefInChatText(m.text);
  if (!gamepassId) return false;
  const user = await db.user.findUnique({ where: { tgId: String(m.fromId) }, select: { id: true } });
  if (!user) return false;
  const [own, linked] = await Promise.all([
    db.wbOrder.findMany({ where: { userId: user.id, status: "AWAITING_GAMEPASS" }, select: { id: true } }),
    db.orderContact.findMany({ where: { userId: user.id, removedAt: null, order: { status: "AWAITING_GAMEPASS" } }, select: { orderId: true } }),
  ]);
  const orderIds = [...own.map((o) => o.id), ...linked.map((l) => l.orderId)];
  if (!orderIds.length) return false;

  const res = await attachGamepassFromSupport(db as never, { orderIds, gamepassId });
  const send = (text: string) => api("sendMessage", {
    business_connection_id: m.connId, chat_id: m.chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true },
  });
  const read = () => api("readBusinessMessage", { business_connection_id: m.connId, chat_id: m.chatId, message_id: m.messageId }).catch(() => undefined);
  const who = escapeHtml(m.fromName);

  if (res.kind === "partial") {
    await send(escapeHtml(splitProgressText(res.order.amount, res.parts)));
    await read();
    await card(bot, `🎟 <b>${who}</b> прислал пасс ${res.gamepassId} (${res.price} R$ → ${res.parts[res.parts.length - 1].amount} R$) для заказа <b>${res.order.wbCode}</b> — набор: ${res.parts.map((p) => p.amount).join(" + ")}, осталось ${res.remaining} R$.`).catch(() => undefined);
    console.log(`[pa-gamepass] часть ${res.gamepassId} → ${res.order.wbCode}, осталось ${res.remaining}`);
    return true;
  }
  if (res.kind === "attached" && res.parts) {
    await send(
      `Все геймпассы приняты ✅ ${res.parts.map((p) => p.amount).join(" + ")} = ${res.order.amount} R$.\n\n` +
      `Заказ поставлен в очередь на выкуп на аккаунт <b>${escapeHtml(res.nick)}</b>. Как только выкупим — напишем.`,
    );
    await read();
    await card(bot, `🎟 <b>${who}</b> собрал набор в поддержке — заказ <b>${res.order.wbCode}</b> (${res.order.amount} R$) в выкуп: ${res.parts.map((p) => `${p.gamepassId} (${p.price}→${p.amount})`).join(", ")}, ник ${escapeHtml(res.nick)}.`).catch(() => undefined);
    void pinPaOrdersNow(String(m.fromId)).catch(() => undefined);
    console.log(`[pa-gamepass] набор → ${res.order.wbCode}`);
    return true;
  }
  if (res.kind === "attached") {
    await send(
      `Геймпасс принят ✅\n\n${res.order.amount} R$ поставлены в очередь на выкуп на аккаунт <b>${escapeHtml(res.nick)}</b>. ` +
      `Как только выкупим — напишем.`,
    );
    await read();
    await card(bot, `🎟 <b>${who}</b> прислал пасс в поддержку — подставлен в заказ <b>${res.order.wbCode}</b> (${res.order.amount} R$): ID ${res.gamepassId}, ${res.price} R$, ник ${escapeHtml(res.nick)}.`).catch(() => undefined);
    void pinPaOrdersNow(String(m.fromId)).catch(() => undefined);
    console.log(`[pa-gamepass] пасс ${res.gamepassId} → ${res.order.wbCode}`);
    return true;
  }
  if (res.kind === "rejected") {
    if (res.toBuyer && res.buyerText) {
      await send(escapeHtml(res.buyerText));
      await read();
    } else if (res.toBuyer) {
      await send(
        `Проверили геймпасс: ${escapeHtml(res.reason)}.\n\n` +
        `Нужен пасс за <b>${res.expectedPrice} R$</b>, выставленный на продажу, без региональных цен (Managed pricing выключен). ` +
        `Исправьте и пришлите ссылку ещё раз — проверим сразу.`,
      );
      await read();
    }
    await card(bot, `🎟 <b>${who}</b> прислал пасс ${res.gamepassId} в поддержку для заказа <b>${res.order.wbCode}</b> — не подставлен: ${escapeHtml(res.reason)}.${res.toBuyer ? " Покупателю ответили." : " Покупателю НЕ отвечали — решите вручную."}`).catch(() => undefined);
    console.log(`[pa-gamepass] пасс ${res.gamepassId} отклонён: ${res.reason}`);
    return res.toBuyer;
  }
  if (res.why === "ambiguous") {
    await card(bot, `🎟 <b>${who}</b> прислал пасс ${gamepassId} в поддержку, но у него несколько заказов на этот номинал — какой выбрать, решите вручную.`).catch(() => undefined);
  }
  return false;
}
