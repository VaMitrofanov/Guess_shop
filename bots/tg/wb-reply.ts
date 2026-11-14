import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { ADMIN_IDS } from "../shared/admin";
import { escapeHtml } from "../shared/notify";
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

const KIND_LABEL = { g: "📖 инструкция", c: "🔑 просьба прислать код", r: "🚚 «курьера нет»" } as const;

export function registerWbReply(bot: Telegraf): void {
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
    await ctx.reply(result.sent ? `✅ Ушло в чат WB · ${escapeHtml(actor)}` : `⚠️ Не ушло: ${wbReplyFailText(result.reason)}`, {
      parse_mode: "HTML",
      disable_notification: true,
      reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
    }).catch(() => undefined);
  });
}
