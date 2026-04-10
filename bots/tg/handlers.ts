/**
 * All Telegraf handler registrations for the TG bot.
 *
 * Import order matters: register command/text/photo handlers BEFORE the
 * generic fallback so Telegraf's middleware chain routes correctly.
 */

import { Telegraf, Markup } from "telegraf";
// telegraf/types re-exports the full typegram surface (official subpath export)
import type { User as TGUser } from "telegraf/types";
import { db } from "../shared/db";
import { vkSend, stripHtml } from "../shared/notify";
import { sendAdminOrderCard, sendAdminReviewCard, CB } from "../shared/admin";
import { pendingLink, pendingReview } from "./session";

// ── Regex for a valid Roblox gamepass URL ─────────────────────────────────────
const GAMEPASS_RE = /^https?:\/\/(www\.)?roblox\.com\/game-pass\/\d+/i;

// ── Small helpers ─────────────────────────────────────────────────────────────

function userDisplay(from: TGUser): string {
  return from.username
    ? `@${from.username}`
    : `<a href="tg://user?id=${from.id}">${from.first_name}</a>`;
}

async function checkSubscription(bot: Telegraf, userId: number): Promise<boolean> {
  const channelId = process.env.TG_CHANNEL_ID;
  if (!channelId) return true;
  try {
    const m = await bot.telegram.getChatMember(channelId, userId);
    return ["member", "administrator", "creator"].includes(m.status);
  } catch {
    return true; // fail-open: don't block users if the check itself fails
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// /start [CODE]
// ─────────────────────────────────────────────────────────────────────────────

export function registerStart(bot: Telegraf): void {
  bot.start(async (ctx) => {
    const tgId = String(ctx.from.id);
    const code  = ctx.startPayload?.trim().toUpperCase() ?? "";

    // No code payload — generic greeting
    if (!code) {
      await ctx.reply(
        "👋 Привет!\n\n" +
        "Для активации кода с карточки Wildberries перейди по ссылке, " +
        "напечатанной на вкладыше.\n\n" +
        "📦 Статус заказа: /status"
      );
      return;
    }

    // Subscription gate (optional — skip if TG_CHANNEL_ID not set)
    const subscribed = await checkSubscription(bot, ctx.from.id);
    if (!subscribed) {
      const channelId = process.env.TG_CHANNEL_ID!;
      const url = channelId.startsWith("@")
        ? `https://t.me/${channelId.slice(1)}`
        : `https://t.me/c/${channelId.replace("-100", "")}`;
      await ctx.reply(
        "⚠️ Для использования сервиса подпишись на наш канал и снова перейди по ссылке с карточки.",
        Markup.inlineKeyboard([[Markup.button.url("📢 Подписаться", url)]])
      );
      return;
    }

    // Validate WB code
    const wbCode = await (db as any).wbCode.findUnique({ where: { code } });
    if (!wbCode) {
      await ctx.reply("❌ Код не найден. Проверь правильность ввода или обратись в поддержку.");
      return;
    }
    if (wbCode.isUsed && wbCode.userId) {
      await ctx.reply("⚠️ Этот код уже был активирован ранее.");
      return;
    }

    // Lazy registration: find or create user
    let user = await (db as any).user.findUnique({ where: { tgId } });
    if (!user) {
      user = await (db as any).user.create({
        data: {
          tgId,
          name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || null,
        },
      });
    }

    // Atomically link code to user
    await (db as any).wbCode.update({
      where: { id: wbCode.id },
      data:  { userId: user.id, isUsed: true, usedAt: new Date() },
    });

    // Enter "waiting for gamepass link" state
    pendingLink.set(ctx.from.id, { wbCode: code, denomination: wbCode.denomination });

    const passPrice = Math.ceil(wbCode.denomination / 0.7);
    await ctx.reply(
      `✅ Код <b>${code}</b> активирован!\n` +
      `💎 Номинал: <b>${wbCode.denomination} R$</b>\n\n` +
      `📋 <b>Что делать дальше:</b>\n` +
      `1. Открой <a href="https://create.roblox.com">create.roblox.com</a>\n` +
      `2. Создай геймпасс и установи цену <b>${passPrice} R$</b>\n` +
      `   (формула: ${wbCode.denomination} ÷ 0.7 = ${passPrice})\n` +
      `3. Скопируй ссылку на геймпасс\n` +
      `4. Отправь её сюда 👇`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// /status — last order info with comforting text for PENDING
// ─────────────────────────────────────────────────────────────────────────────

export function registerStatus(bot: Telegraf): void {
  bot.command("status", async (ctx) => {
    const tgId = String(ctx.from.id);
    const user  = await (db as any).user.findUnique({ where: { tgId } });

    if (!user) {
      await ctx.reply(
        "У тебя пока нет заказов. Активируй код с карточки Wildberries через /start."
      );
      return;
    }

    const order = await (db as any).wbOrder.findFirst({
      where:   { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!order) {
      await ctx.reply(
        "У тебя пока нет заявок. Отправь ссылку на геймпасс, чтобы создать заявку."
      );
      return;
    }

    const label: Record<string, string> = {
      PENDING:   "⏳ В обработке",
      COMPLETED: "✅ Выполнен",
      REJECTED:  "❌ Отклонён",
    };

    const calmNote =
      order.status === "PENDING"
        ? "\n\n💬 <i>Менеджеры работают в порядке очереди — среднее время обработки " +
          "15–30 минут. Дополнительно писать не нужно: мы сами пришлём уведомление " +
          "при изменении статуса.</i>"
        : "";

    await ctx.reply(
      `📦 <b>Заявка #${order.id.slice(-6).toUpperCase()}</b>\n` +
      `📅 ${new Date(order.createdAt).toLocaleDateString("ru-RU")}\n` +
      `💎 Номинал: <b>${order.amount} R$</b>\n` +
      `🔗 <a href="${order.gamepassUrl}">Геймпасс</a>\n` +
      `📊 Статус: <b>${label[order.status] ?? order.status}</b>` +
      calmNote,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Text messages — collect gamepass URL
// ─────────────────────────────────────────────────────────────────────────────

export function registerText(bot: Telegraf): void {
  bot.on("text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return; // let commands pass through

    const state = pendingLink.get(ctx.from.id);
    if (!state) return; // not in an active flow

    const url = ctx.message.text.trim();

    if (!GAMEPASS_RE.test(url)) {
      await ctx.reply(
        "⚠️ Некорректная ссылка.\n\n" +
        "Ссылка должна быть в формате:\n" +
        "<code>https://www.roblox.com/game-pass/1234567/название</code>\n\n" +
        "Скопируй её из адресной строки браузера на странице своего геймпасса.",
        { parse_mode: "HTML" }
      );
      return;
    }

    const tgId = String(ctx.from.id);
    const user  = await (db as any).user.findUnique({ where: { tgId } });
    if (!user) {
      await ctx.reply("Ошибка сессии. Пожалуйста, пройди активацию кода повторно через /start.");
      return;
    }

    // Create WbOrder
    const order = await (db as any).wbOrder.create({
      data: {
        amount:      state.denomination,
        gamepassUrl: url,
        status:      "PENDING",
        platform:    "TG",
        userId:      user.id,
        wbCode:      state.wbCode,
      },
    });

    pendingLink.delete(ctx.from.id);

    await ctx.reply(
      `✅ <b>Заявка принята!</b>\n\n` +
      `🆔 Номер: <code>${order.id.slice(-6).toUpperCase()}</code>\n` +
      `Менеджер обработает её и пришлёт уведомление.\n\n` +
      `📊 Проверить статус в любой момент: /status`,
      { parse_mode: "HTML" }
    );

    // Notify all Telegram admins
    await sendAdminOrderCard({
      id:          order.id,
      amount:      order.amount,
      gamepassUrl: url,
      platform:    "TG",
      wbCode:      state.wbCode,
      userDisplay: userDisplay(ctx.from),
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Photo messages — collect review screenshots
// ─────────────────────────────────────────────────────────────────────────────

export function registerPhoto(bot: Telegraf): void {
  bot.on("photo", async (ctx) => {
    const tgId = String(ctx.from.id);
    const user  = await (db as any).user.findUnique({ where: { tgId } });
    if (!user) return;

    // 1. Check in-memory state first (fastest path)
    let orderId = pendingReview.get(ctx.from.id);

    // 2. DB fallback: latest COMPLETED order whose review bonus is not yet claimed
    if (!orderId) {
      const order = await (db as any).wbOrder.findFirst({
        where:   { userId: user.id, status: "COMPLETED" },
        orderBy: { updatedAt: "desc" },
      });
      const linked = order
        ? await (db as any).wbCode.findFirst({
            where: { userId: user.id, reviewBonusClaimed: false },
          })
        : null;

      if (!order || !linked) return; // user has nothing to review
      orderId = order.id as string;
    }

    pendingReview.delete(ctx.from.id);

    // Telegram file_id of the largest photo size
    const fileId = ctx.message.photo.at(-1)!.file_id;

    await ctx.reply(
      "✅ Скриншот получен! Ожидай решения администратора — обычно это занимает до 30 минут."
    );

    await sendAdminReviewCard({
      orderId,
      userId:      user.id as string,
      photoSource: fileId,
      userDisplay: userDisplay(ctx.from),
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Callback queries — admin interactive actions
// ─────────────────────────────────────────────────────────────────────────────

export function registerCallbacks(bot: Telegraf): void {
  bot.on("callback_query", async (ctx) => {
    const cbq = ctx.callbackQuery;
    if (!("data" in cbq)) return ctx.answerCbQuery();

    const data    = cbq.data;
    const adminId = String(ctx.from.id);
    const adminTag = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "Админ";

    // ── ✅ admin_ok: order completed ──────────────────────────────────────
    // ── ❌ admin_err: order rejected ──────────────────────────────────────
    if (data.startsWith("admin_ok:") || data.startsWith("admin_err:")) {
      const [action, orderId] = data.split(":");
      const newStatus = action === "admin_ok" ? "COMPLETED" : "REJECTED";

      const order = await (db as any).wbOrder.update({
        where: { id: orderId },
        data:  { status: newStatus, adminId },
      });
      const user = await (db as any).user.findUnique({ where: { id: order.userId } });

      const badge = newStatus === "COMPLETED" ? "✅" : "❌";
      const verb  = newStatus === "COMPLETED" ? "Выкуплено" : "Ошибка";
      const editedText =
        `${badge} <b>${verb}</b> — ${adminTag}\n` +
        `Заказ #${orderId.slice(-6).toUpperCase()} · ${order.amount} R$`;

      try { await ctx.editMessageText(editedText, { parse_mode: "HTML" }); } catch { /* stale message */ }

      // Notify the user on their platform
      if (user) {
        if (newStatus === "COMPLETED") {
          await notifyUserCompleted(bot, user, orderId, order.amount);
        } else {
          await notifyUserRejected(bot, user, orderId);
        }
      }

      await ctx.answerCbQuery(newStatus === "COMPLETED" ? "✅ Выполнено" : "❌ Отклонено");
      return;
    }

    // ── 🎁 review_ok: approve review bonus ───────────────────────────────
    // ── ❌ review_no: reject review bonus ────────────────────────────────
    if (data.startsWith("review_ok:") || data.startsWith("review_no:")) {
      const [action, orderId, userId] = data.split(":");
      const approve = action === "review_ok";

      if (approve) {
        // Award +50 R$ and mark bonus as claimed
        await (db as any).user.update({
          where: { id: userId },
          data:  { balance: { increment: 50 } },
        });
        await (db as any).wbCode.updateMany({
          where: { userId, reviewBonusClaimed: false },
          data:  { reviewBonusClaimed: true },
        });

        const user = await (db as any).user.findUnique({ where: { id: userId } });
        const bonusMsg =
          `🎁 <b>+50 R$ зачислено на счёт!</b>\n` +
          `Спасибо за отзыв — бонус доступен при следующей покупке 💛`;

        if (user?.tgId) {
          try { await bot.telegram.sendMessage(user.tgId, bonusMsg, { parse_mode: "HTML" }); } catch {}
        } else if (user?.vkId) {
          await vkSend(user.vkId, stripHtml(bonusMsg));
        }
      }

      const result = approve
        ? `🎁 Бонус начислен — ${adminTag}`
        : `❌ Отклонено — ${adminTag}`;
      const caption = `${result}\nЗаказ #${orderId.slice(-6).toUpperCase()}`;

      try { await ctx.editMessageCaption(caption, { parse_mode: "HTML" }); } catch {}
      await ctx.answerCbQuery(approve ? "+50 R$ начислено" : "Отклонено");
      return;
    }

    await ctx.answerCbQuery();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers: user notifications after admin action
// ─────────────────────────────────────────────────────────────────────────────

async function notifyUserCompleted(
  bot: Telegraf,
  user: { tgId?: string | null; vkId?: string | null; id: string },
  orderId: string,
  amount: number
): Promise<void> {
  const msg =
    `🎉 <b>Заявка #${orderId.slice(-6).toUpperCase()} выполнена!</b>\n\n` +
    `Геймпасс на <b>${amount} R$</b> выкуплен. Robux поступят на баланс ` +
    `Roblox в течение 5–7 дней.\n\n` +
    `⭐ Оставь отзыв на Wildberries и пришли скриншот — получишь <b>+50 R$</b>!`;

  if (user.tgId) {
    try {
      await bot.telegram.sendMessage(user.tgId, msg, { parse_mode: "HTML" });
      pendingReview.set(parseInt(user.tgId), orderId);
    } catch {}
  } else if (user.vkId) {
    // VK bot will detect the COMPLETED state on next message; also notify directly
    await vkSend(user.vkId, stripHtml(msg));
  }
}

async function notifyUserRejected(
  bot: Telegraf,
  user: { tgId?: string | null; vkId?: string | null },
  orderId: string
): Promise<void> {
  const msg =
    `❌ <b>Заявка #${orderId.slice(-6).toUpperCase()} отклонена.</b>\n` +
    `Обратись в поддержку для уточнения причины.`;

  if (user.tgId) {
    try { await bot.telegram.sendMessage(user.tgId, msg, { parse_mode: "HTML" }); } catch {}
  } else if (user.vkId) {
    await vkSend(user.vkId, stripHtml(msg));
  }
}
