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
import { sendAdminOrderCard, sendAdminReviewCard, CB, ADMIN_IDS } from "../shared/admin";
import { pendingLink, pendingReview } from "./session";

// ── Regex for a valid Roblox gamepass URL ─────────────────────────────────────
const GAMEPASS_RE = /^https?:\/\/(www\.)?roblox\.com\/game-pass\/\d+/i;

// ── Small helpers ─────────────────────────────────────────────────────────────

function userDisplay(from: TGUser): string {
  const name = from.username ? `@${from.username}` : from.first_name;
  return `${name} (ID: ${from.id})`;
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
      `📋 <b>Что делать дальше:</b>\n\n` +
      `1. Скопируй ссылку на геймпасс (убедись, что цена в нем <b>${passPrice} R$</b>)\n` +
      `2. Отправь её сюда 👇`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// /status — last order info with comforting text for PENDING
// ─────────────────────────────────────────────────────────────────────────────

export function registerStatus(bot: Telegraf): void {
  bot.command("status", async (ctx) => {
    const text = await getStatusText(String(ctx.from.id));
    await ctx.reply(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...Markup.inlineKeyboard([[
        Markup.button.callback("🔄 Обновить", CB.refreshStatus)
      ]])
    });
  });
}

/** Helper for /status and refresh callback */
async function getStatusText(tgId: string): Promise<string> {
  const user = await (db as any).user.findUnique({ where: { tgId } });
  if (!user) {
    return "У тебя пока нет заказов. Активируй код с карточки Wildberries через /start.";
  }

  const order = await (db as any).wbOrder.findFirst({
    where:   { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  if (!order) {
    return "У тебя пока нет заявок. Отправь ссылку на геймпасс, чтобы создать заявку.";
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

  return (
    `📦 <b>Заявка #${order.id.slice(-6).toUpperCase()}</b>\n` +
    `📅 ${new Date(order.createdAt).toLocaleDateString("ru-RU")}\n` +
    `💎 Номинал: <b>${order.amount} R$</b>\n` +
    `🔗 <a href="${order.gamepassUrl}">Геймпасс</a>\n` +
    `📊 Статус: <b>${label[order.status] ?? order.status}</b>` +
    calmNote
  );
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

export function registerAdmin(bot: Telegraf): void {
  bot.command("admin", async (ctx) => {
    if (!ADMIN_IDS.includes(String(ctx.from.id))) return;

    await ctx.reply(
      "🛠️ <b>Панель управления</b>\n\n" +
      "Выбери раздел для управления магазином:",
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("📊 Статистика", CB.adminStats)],
          [Markup.button.callback("🕒 Очередь", CB.adminQueue)],
          [Markup.button.callback("🔑 Остаток кодов", CB.adminCodes)],
        ])
      }
    );
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

      const editedText = newStatus === "COMPLETED"
        ? `✅ <b>Выполнено админом ${adminTag}</b>\nЗаказ #${orderId.slice(-6).toUpperCase()} · ${order.amount} R$`
        : `❌ <b>Ошибка в заказе (Отклонил: ${adminTag})</b>\nЗаказ #${orderId.slice(-6).toUpperCase()} · ${order.amount} R$`;

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

    // ── 📊 admin_stats: stats for day/week ────────────────────────────────
    if (data === CB.adminStats) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("Доступ запрещен");

      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const dayStats = await (db as any).wbOrder.aggregate({
        _count: true,
        _sum: { amount: true },
        where: { status: "COMPLETED", updatedAt: { gte: startOfDay } }
      });

      const weekStats = await (db as any).wbOrder.aggregate({
        _count: true,
        _sum: { amount: true },
        where: { status: "COMPLETED", updatedAt: { gte: startOfWeek } }
      });

      const statsText = 
        `📊 <b>СТАТИСТИКА (RobloxBank)</b>\n\n` +
        `📅 <b>ЗА СЕГОДНЯ:</b>\n` +
        `• Кол-во: <b>${dayStats._count}</b>\n` +
        `• Сумма: <b>${dayStats._sum.amount || 0} R$</b>\n\n` +
        `📅 <b>ЗА 7 ДНЕЙ:</b>\n` +
        `• Кол-во: <b>${weekStats._count}</b>\n` +
        `• Сумма: <b>${weekStats._sum.amount || 0} R$</b>`;

      try {
        await ctx.editMessageText(statsText, {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("← Назад", "admin_main")]])
        });
      } catch {}
      return ctx.answerCbQuery();
    }

    // ── 🕒 admin_queue: list pending orders ────────────────────────────────
    if (data === CB.adminQueue) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("Доступ запрещен");

      const pending = await (db as any).wbOrder.findMany({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        take: 10
      });

      if (pending.length === 0) {
        await ctx.editMessageText("🕒 Очередь пуста. Все заказы выкуплены!", {
          ...Markup.inlineKeyboard([[Markup.button.callback("← Назад", "admin_main")]])
        });
        return ctx.answerCbQuery();
      }

      let qText = `🕒 <b>ОЧЕРЕДЬ (PENDING)</b>\n\n`;
      pending.forEach((o: any, i: number) => {
        const shortId = o.id.slice(-6).toUpperCase();
        qText += `${i+1}. <code>${shortId}</code> — <b>${o.amount} R$</b> (<a href="${o.gamepassUrl}">пасс</a>)\n`;
      });

      try {
        await ctx.editMessageText(qText, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          ...Markup.inlineKeyboard([[Markup.button.callback("← Назад", "admin_main")]])
        });
      } catch {}
      return ctx.answerCbQuery();
    }

    // ── 🔑 admin_codes: check remain codes ────────────────────────────────
    if (data === CB.adminCodes) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("Доступ запрещен");

      const codes = await (db as any).wbCode.groupBy({
        by: ['denomination'],
        _count: { _all: true },
        where: { isUsed: false }
      });

      let cText = `🔑 <b>ОСТАТОК КОДОВ:</b>\n\n`;
      let total = 0;
      codes.sort((a: any, b: any) => a.denomination - b.denomination).forEach((group: any) => {
        cText += `• <b>${group.denomination} R$</b>: ${group._count._all} шт.\n`;
        total += group._count._all;
      });
      cText += `\n📦 <b>ВСЕГО: ${total} шт.</b>`;

      if (total === 0) cText = "🔑 Коды закончились! Пора загрузить новые.";

      try {
        await ctx.editMessageText(cText, {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("← Назад", "admin_main")]])
        });
      } catch {}
      return ctx.answerCbQuery();
    }

    // ── 🔄 admin_main: back to admin menu ───────────────────────────────
    if (data === "admin_main") {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("Доступ запрещен");
      try {
        await ctx.editMessageText(
          "🛠️ <b>Панель управления</b>\n\nВыбери раздел для управления магазином:",
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("📊 Статистика", CB.adminStats)],
              [Markup.button.callback("🕒 Очередь", CB.adminQueue)],
              [Markup.button.callback("🔑 Остаток кодов", CB.adminCodes)],
            ])
          }
        );
      } catch {}
      return ctx.answerCbQuery();
    }

    // ── 🔄 refresh_status: user refresh ──────────────────────────────────
    if (data === CB.refreshStatus) {
      const text = await getStatusText(adminId);
      try {
        await ctx.editMessageText(text, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          ...Markup.inlineKeyboard([[
            Markup.button.callback("🔄 Обновить", CB.refreshStatus)
          ]])
        });
      } catch {}
      return ctx.answerCbQuery("Обновлено");
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
    `✅ Ваш заказ #${orderId.slice(-6).toUpperCase()} выкуплен! ` +
    `Робуксы придут через 5-7 дней.`;

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
    `❌ Ошибка в вашем заказе #${orderId.slice(-6).toUpperCase()}. ` +
    `Проверьте цену геймпасса и отправьте ссылку заново или напишите в поддержку.`;

  if (user.tgId) {
    try { await bot.telegram.sendMessage(user.tgId, msg, { parse_mode: "HTML" }); } catch {}
  } else if (user.vkId) {
    await vkSend(user.vkId, stripHtml(msg));
  }
}
