import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { ADMIN_IDS } from "../shared/admin";
import { escapeHtml } from "../shared/notify";
import { recordOperatorExample } from "../shared/support-ai-learn";
import { isAutoSellerText } from "../shared/wb-chat-ai";
import { noteDbsAdminReply } from "../shared/wb-delivery-admin-notify";
import { ACCOUNT_HANDOFF_TEXT, refreshManualRow, setManualMode, WB_AI_ACCOUNT_CB, WB_AI_AUTO_CB, WB_AI_MANUAL_CB, WB_AI_NOOP_CB, WB_AI_SEND_CB } from "../shared/wb-ai-cards";
import { setFlag } from "../shared/order-flags";
import { parseWbReplyCallback, sendWbChatReply, wbOrderForMessage, wbReplyFailText, wbReplyTemplate } from "../shared/wb-chat-reply";

/* ─────────────────────────────────────────────────────────────────────────────
   💬 Ответ в чат WB из Telegram (15.11.2026). Кнопки под уведом «покупатель
   пишет» и «ответить на увед = написать покупателю». Только ADMIN_IDS.
   Регистрируется ДО беседы админов (`registerPaGroup`): иначе ответ на
   сообщение бота забрал бы ассистент беседы.
   ───────────────────────────────────────────────────────────────────────── */

const isAdmin = (id: number | undefined) => id !== undefined && ADMIN_IDS.includes(String(id));
const actorOf = (from: { id: number; username?: string; first_name?: string }) =>
  from.username ? `@${from.username}` : from.first_name || String(from.id);

async function lastBuyerWbText(wbOrderId: string): Promise<string | null> {
  const mp = await db.wbMarketplaceOrder.findFirst({ where: { wbOrderId }, select: { id: true } }).catch(() => null);
  if (!mp) return null;
  const ev = await db.wbBuyerChatEvent.findFirst({
    where: { marketplaceOrderId: mp.id, sender: "client", textRedacted: { not: null } },
    orderBy: { sentAt: "desc" }, select: { textRedacted: true },
  }).catch(() => null);
  return ev?.textRedacted?.trim() || null;
}

const KIND_LABEL = { g: "📖 инструкция", c: "🔑 просьба прислать код", r: "🚚 «курьера нет»" } as const;

export function registerWbReply(bot: Telegraf): void {
  /* 📤 Ответ воркера ИИ в чат WB одной кнопкой (27.11.2026). Текст лежит в
     событии `ai-chat:<wbEventId>`; повторное нажатие ничего не шлёт. */
  bot.action(new RegExp(`^${WB_AI_SEND_CB}(.+)$`), async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("Только для админов").catch(() => undefined);
    const eventId = (ctx.match as RegExpMatchArray)[1];
    const ev = await db.wbMarketplaceEvent.findUnique({
      where: { idempotencyKey: `ai-chat:${eventId}` },
      select: { id: true, payload: true, marketplaceOrderId: true, createdAt: true },
    }).catch(() => null);
    const payload = (ev?.payload ?? {}) as { draft?: string | null; sentBy?: string };
    if (!ev || !payload.draft) return ctx.answerCbQuery("Ответа нет — напишите сами", { show_alert: true }).catch(() => undefined);
    if (payload.sentBy) return ctx.answerCbQuery(`Уже отправил ${payload.sentBy}`).catch(() => undefined);
    const closed = (payload as { closed?: string }).closed;
    if (closed) return ctx.answerCbQuery(`Устарело: ${closed}. Черновик не отправлен.`, { show_alert: true }).catch(() => undefined);
    const mp = await db.wbMarketplaceOrder.findUnique({ where: { id: ev.marketplaceOrderId! }, select: { wbOrderId: true } }).catch(() => null);
    if (!mp) return ctx.answerCbQuery("Заказ не найден").catch(() => undefined);
    /* Карточка устарела (27.11.2026, VWU5YU8): черновик 08:31 ушёл в 08:44, хотя
       в 08:41 владелец уже ответил руками. После карточки в чате ответили или
       есть карточка новее — не шлём. */
    const [answeredAfter, newer] = await Promise.all([
      db.wbBuyerChatEvent.findMany({
        where: { marketplaceOrderId: ev.marketplaceOrderId!, sender: { not: "client" }, sentAt: { gt: ev.createdAt } },
        select: { textRedacted: true }, take: 20,
      }).catch(() => [] as { textRedacted: string | null }[]),
      db.wbMarketplaceEvent.findFirst({
        where: { marketplaceOrderId: ev.marketplaceOrderId!, type: { in: ["AI_CHAT_ESCALATED", "AI_CHAT_REPLIED"] }, createdAt: { gt: ev.createdAt } },
        select: { id: true },
      }).catch(() => null),
    ]);
    if (newer || answeredAfter.some((m: { textRedacted: string | null }) => m.textRedacted && !isAutoSellerText(m.textRedacted))) {
      await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
      return ctx.answerCbQuery("Устарело: после этой карточки в чате уже ответили или пришла новая. Черновик не отправлен.", { show_alert: true }).catch(() => undefined);
    }
    const actor = actorOf(ctx.from);
    const result = await sendWbChatReply(db as never, mp.wbOrderId, payload.draft, actor);
    if (!result.sent) {
      await ctx.answerCbQuery(`Не ушло: ${wbReplyFailText(result.reason)}`, { show_alert: true }).catch(() => undefined);
      return;
    }
    // Кнопки карточек уже переписал sendWbChatReply («✅ ответил …»).
    const fresh = await db.wbMarketplaceEvent.findUnique({ where: { id: ev.id }, select: { payload: true } }).catch(() => null);
    await db.wbMarketplaceEvent.update({ where: { id: ev.id }, data: { payload: { ...((fresh?.payload ?? payload) as object), sentBy: actor, sentAt: new Date().toISOString() } } }).catch(() => undefined);
    await ctx.answerCbQuery("Отправлено").catch(() => undefined);
    await ctx.reply(`📤 ${escapeHtml(actor)} отправил ответ воркера в чат WB.`, {
      parse_mode: "HTML", disable_notification: true,
      reply_parameters: { message_id: (ctx.callbackQuery as { message?: { message_id: number } }).message?.message_id ?? 0, allow_sending_without_reply: true },
    }).catch(() => undefined);
  });

  bot.action(WB_AI_NOOP_CB, (ctx) => ctx.answerCbQuery().catch(() => undefined));

  /* ✋ Веду сам / 🤖 Вернуть воркеру — ручной режим заказа (сутки максимум). */
  bot.action(new RegExp(`^(${WB_AI_MANUAL_CB}|${WB_AI_AUTO_CB})(.+)$`), async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("Только для админов").catch(() => undefined);
    const [, kind, orderId] = ctx.match as RegExpMatchArray;
    const on = kind === WB_AI_MANUAL_CB;
    const actor = actorOf(ctx.from);
    const ok = await db.wbMarketplaceOrder.findUnique({ where: { id: orderId }, select: { id: true } }).catch(() => null);
    if (!ok) return ctx.answerCbQuery("Заказ не найден").catch(() => undefined);
    await setManualMode(db as never, orderId, on, actor);
    await ctx.answerCbQuery(on ? "Ведёте сами — воркер только предлагает (до суток)" : "Воркер снова отвечает сам").catch(() => undefined);
    await refreshManualRow(db as never, orderId, on).catch(() => undefined);
    await ctx.reply(on ? `✋ ${escapeHtml(actor)} ведёт чат сам — воркер молчит и только предлагает.` : `🤖 ${escapeHtml(actor)} вернул чат воркеру.`, {
      parse_mode: "HTML", disable_notification: true,
      reply_parameters: { message_id: (ctx.callbackQuery as { message?: { message_id: number } }).message?.message_id ?? 0, allow_sending_without_reply: true },
    }).catch(() => undefined);
  });

  /* 🔐 Взять аккаунт на себя: просим логин и пароль, пометка «Делаем за клиента»,
     ручной режим — пока разбираемся с доступом, воркер не вмешивается. */
  bot.action(new RegExp(`^${WB_AI_ACCOUNT_CB}(.+)$`), async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("Только для админов").catch(() => undefined);
    const eventId = (ctx.match as RegExpMatchArray)[1];
    const ev = await db.wbMarketplaceEvent.findUnique({ where: { idempotencyKey: `ai-chat:${eventId}` }, select: { marketplaceOrderId: true, payload: true } }).catch(() => null);
    const mp = ev?.marketplaceOrderId
      ? await db.wbMarketplaceOrder.findUnique({ where: { id: ev.marketplaceOrderId }, select: { id: true, wbOrderId: true } }).catch(() => null)
      : null;
    if (!mp) return ctx.answerCbQuery("Заказ не найден").catch(() => undefined);
    const code = ((ev!.payload ?? {}) as { code?: string }).code;
    const actor = actorOf(ctx.from);
    const result = await sendWbChatReply(db as never, mp.wbOrderId, ACCOUNT_HANDOFF_TEXT, actor);
    if (!result.sent) return ctx.answerCbQuery(`Не ушло: ${wbReplyFailText(result.reason)}`, { show_alert: true }).catch(() => undefined);
    if (code) await setFlag(db as never, { wbCode: code, kind: "ACCOUNT_HANDOFF", detail: `взял ${actor}` }).catch(() => undefined);
    await setManualMode(db as never, mp.id, true, actor).catch(() => undefined);
    await refreshManualRow(db as never, mp.id, true).catch(() => undefined);
    await ctx.answerCbQuery("Попросили логин и пароль, заказ помечен 🔐").catch(() => undefined);
    await ctx.reply(`🔐 ${escapeHtml(actor)} взял аккаунт на себя: покупателю ушла просьба прислать логин и пароль, заказ помечен «Делаем за клиента», воркер молчит.`, {
      parse_mode: "HTML", disable_notification: true,
      reply_parameters: { message_id: (ctx.callbackQuery as { message?: { message_id: number } }).message?.message_id ?? 0, allow_sending_without_reply: true },
    }).catch(() => undefined);
  });

  bot.action(/^wbr:/, async (ctx) => {
    const data = (ctx.callbackQuery as { data?: string }).data ?? "";
    const parsed = parseWbReplyCallback(data);
    if (!parsed) return ctx.answerCbQuery().catch(() => undefined);
    if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("Только для админов").catch(() => undefined);
    const noticeId = (ctx.callbackQuery as { message?: { message_id: number } }).message?.message_id;
    if (parsed.kind === "w") {
      await ctx.answerCbQuery("Ответьте на этот увед — текст уйдёт в чат WB").catch(() => undefined);
      await ctx.reply("✍️ Ответьте на увед выше (свайп влево или «Ответить») — текст уйдёт покупателю в чат WB.", {
        ...(noticeId ? { reply_parameters: { message_id: noticeId, allow_sending_without_reply: true } } : {}),
        disable_notification: true,
      }).catch(() => undefined);
      return;
    }
    const actor = actorOf(ctx.from);
    const text = await wbReplyTemplate(db as never, parsed.wbOrderId, parsed.kind);
    const result = await sendWbChatReply(db as never, parsed.wbOrderId, text, actor);
    if (!result.sent) {
      await ctx.answerCbQuery(`Не ушло: ${wbReplyFailText(result.reason)}`, { show_alert: true }).catch(() => undefined);
      return;
    }
    await ctx.answerCbQuery("Ушло в чат WB ✅").catch(() => undefined);
    // Отметка «кто ответил» — строкой в том же уведе; отдельное сообщение —
    // только если разговора уже нет в памяти (рестарт бота).
    if (await noteDbsAdminReply(parsed.wbOrderId, actor, KIND_LABEL[parsed.kind])) return;
    await ctx.reply(`✅ В чат WB · ${escapeHtml(actor)}: ${KIND_LABEL[parsed.kind]}`, {
      parse_mode: "HTML",
      disable_notification: true,
      ...(noticeId ? { reply_parameters: { message_id: noticeId, allow_sending_without_reply: true } } : {}),
    }).catch(() => undefined);
  });

  bot.on("message", async (ctx, next) => {
    const msg = ctx.message as { text?: string; message_id: number; reply_to_message?: { message_id: number; from?: { id: number } } };
    const replyTo = msg.reply_to_message;
    if (!replyTo || !msg.text || msg.text.startsWith("/") || !isAdmin(ctx.from?.id)) return next();
    if (replyTo.from?.id !== ctx.botInfo?.id) return next();
    const wbOrderId = await wbOrderForMessage(db as never, ctx.chat.id, replyTo.message_id).catch(() => null);
    if (!wbOrderId) return next();
    const actor = actorOf(ctx.from);
    const result = await sendWbChatReply(db as never, wbOrderId, msg.text, actor);
    // 🧠 Ответ админа в чат WB — пример для ИИ (27.11.2026): вопрос — последнее слово покупателя.
    if (result.sent) void lastBuyerWbText(wbOrderId).then(async (q) => { if (q) await recordOperatorExample(db, { channel: "wb_chat", question: q, answer: msg.text!, by: actor }); });
    if (result.sent && await noteDbsAdminReply(wbOrderId, actor, msg.text)) {
      await ctx.react("👍").catch(() => undefined);
      return;
    }
    await ctx.reply(result.sent ? `✅ Ушло в чат WB · ${escapeHtml(actor)}` : `⚠️ Не ушло: ${wbReplyFailText(result.reason)}`, {
      parse_mode: "HTML",
      disable_notification: true,
      reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
    }).catch(() => undefined);
  });
}
