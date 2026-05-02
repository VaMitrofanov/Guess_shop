/**
 * Inline widget helpers for the admin dashboard.
 *
 * Core idea: each admin has at most ONE "active widget" message. When the
 * admin switches hubs or navigates inside a hub, the bot edits that same
 * message instead of sending a new one — zero spam.
 *
 * Telegram throws "Bad Request: message is not modified" when editMessageText
 * receives identical content.  All helpers silently swallow that error.
 */

import type { Context } from "telegraf";
import { adminWidgetMsg } from "../session";

// Timestamp of the current process start — used to detect the first admin
// interaction after a bot restart and prepend a restart banner.
const BOT_STARTED_AT = Date.now();
const RESTART_BANNER_TTL_MS = 120_000; // show banner only within 2 min of startup

/**
 * Send a new widget message (or edit existing one) and track its message_id.
 *
 * Logic:
 *   1. If admin already has a tracked widget message → try editMessageText.
 *   2. If edit fails (deleted, too old, etc.) → send new message and track it.
 *   3. If no tracked widget → send new message.
 */
export async function sendOrEditWidget(
  ctx: Context,
  text: string,
  extra: any = {}
): Promise<void> {
  const userId = ctx.from!.id;
  const existingMsgId = adminWidgetMsg.get(userId);

  if (existingMsgId) {
    try {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        existingMsgId,
        undefined,
        text,
        { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra }
      );
      return; // Success — reused existing message
    } catch {
      // Message was deleted, too old, or content identical — fall through to send new
    }
  }

  // First interaction after a restart: prepend a one-time banner so admins know
  // the bot was reloaded and the previous widget session is gone.
  const isJustRestarted =
    !existingMsgId && Date.now() - BOT_STARTED_AT < RESTART_BANNER_TTL_MS;
  const finalText = isJustRestarted
    ? `🔄 <i>Бот перезапущен. Сессия обновлена.</i>\n\n${text}`
    : text;

  const sent = await ctx.reply(finalText, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...extra,
  });
  adminWidgetMsg.set(userId, sent.message_id);
}

/**
 * Edit the current widget message (callback_query context).
 * Used from inline button handlers where ctx.editMessageText is available.
 */
export async function editWidget(
  ctx: Context,
  text: string,
  extra: any = {}
): Promise<void> {
  try {
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...extra,
    });
    // Update tracked message_id (it stays the same after edit, but just in case)
    const msg = (ctx.callbackQuery as any)?.message;
    if (msg) {
      adminWidgetMsg.set(ctx.from!.id, msg.message_id);
    }
  } catch {
    // "message is not modified" or message was deleted — silently ignore
  }
}
