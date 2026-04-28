/**
 * All Telegraf handler registrations for the TG bot.
 *
 * Import order matters: register command/text/photo handlers BEFORE the
 * generic fallback so Telegraf's middleware chain routes correctly.
 */

import { Telegraf, Markup } from "telegraf";
// telegraf/types re-exports the full typegram surface (official subpath export)
import type { User as TGUser } from "telegraf/types";
import { db, getCustomerStatus } from "../shared/db";
import { vkSend, stripHtml } from "../shared/notify";
import { sendAdminOrderCard, sendAdminReviewCard, CB, ADMIN_IDS } from "../shared/admin";
import { pendingLink, pendingReview, pendingRejectionReason } from "./session";
import { getGamepassDetails } from "../shared/roblox";

// ── Gamepass ID extractor ─────────────────────────────────────────────────────

/**
 * Extract a Roblox game-pass ID from user input.
 * Accepts:
 *   - Pure numeric ID:           "12345678"
 *   - Standard URL:              "https://www.roblox.com/game-pass/12345678/..."
 *   - Creator dashboard URL:     "https://create.roblox.com/dashboard/creations/passes/12345678/..."
 * Returns the ID string, or null if nothing was recognised.
 */
function extractPassId(input: string): string | null {
  const s = input.trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/(?:game-pass|passes)\/(\d+)/i);
  return m ? m[1] : null;
}

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
      const isAdmin = ADMIN_IDS.includes(tgId);
      const { isReturning } = await getCustomerStatus(tgId, "TG");
      if (isReturning && !isAdmin) {
        await ctx.reply(
          "🎖️ С возвращением в RobloxBank! Спасибо за доверие. " +
          "Твои заказы всегда в приоритете. Ожидаем твой код или ссылку!\n\n" +
          "📦 Статус заказа: /status",
          { parse_mode: "HTML" }
        );
      } else {
        await ctx.reply(
          "👋 Привет!\n\n" +
          "Для активации кода с карточки Wildberries перейди по ссылке, " +
          "напечатанной на вкладыше.\n\n" +
          "📦 Статус заказа: /status",
          isAdmin ? getAdminKeyboard() : {}
        );
      }
      return;
    }

    // Subscription gate (optional — skip if TG_CHANNEL_ID not set)
    const subscribed = await checkSubscription(bot, ctx.from.id);
    if (!subscribed) {
      await ctx.reply(
        `💎 Почти готово! Подпишись на наш канал, чтобы активировать код.\n` +
        `Там мы публикуем секретные промокоды на робуксы: https://t.me/Roblox_Bank_Tg\n\n` +
        `Подписавшись, ты получишь доступ к:\n` +
        `1. 🏆 Приоритетной очереди выкупа.\n` +
        `2. 🎰 Розыгрышам робуксов каждый понедельник.\n` +
        `3. 💬 Моментальной поддержке 24/7.`,
        {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          ...Markup.inlineKeyboard([[
            Markup.button.url("📢 Подписаться", "https://t.me/Roblox_Bank_Tg")
          ]]),
        }
      );
      return;
    }

    // Case-insensitive code lookup (handles any stored-case variations)
    const wbCode = await (db as any).wbCode.findFirst({
      where: { code: { equals: code, mode: "insensitive" } },
    });
    if (!wbCode) {
      await ctx.reply("❌ Код не найден. Проверь правильность ввода или обратись в поддержку.");
      return;
    }
    // Only hard-block when code is definitively claimed (isUsed + userId set).
    // isUsed=true with userId=null means the site pre-activated it — the bot
    // will link the user atomically at the gamepass-submission step below.
    if (wbCode.isUsed && wbCode.userId != null) {
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

    const totalAmount = wbCode.denomination + (user.balance || 0);

    // ── Defer isUsed write to the gamepass step ────────────────────────────
    // The code is claimed atomically (userId:null → user.id, isUsed→true) only
    // after Roblox validates the gamepass — see the $transaction in registerText.
    // This prevents orphaned "used" codes when Roblox times out or rejects.
    pendingLink.set(ctx.from.id, { wbCode: wbCode.code, denomination: totalAmount });

    const passPrice = Math.ceil(totalAmount / 0.7);
    const isAdmin = ADMIN_IDS.includes(tgId);

    let bonusText = "";
    if (user.balance && user.balance > 0) {
      bonusText = `🎁 Использован бонус: <b>${user.balance} R$</b>\n` +
                  `💎 Итого к выдаче: <b>${totalAmount} R$</b>\n\n`;
    } else {
      bonusText = `💎 Номинал: <b>${wbCode.denomination} R$</b>\n\n`;
    }

    await ctx.reply(
      `✅ Код <b>${code}</b> активирован!\n` +
      bonusText +
      `📋 <b>Осталось сделать всего один шаг:</b>\n\n` +
      `Пришли нам <b>Asset ID</b>, либо <b>ссылку</b> на твой геймпасс. Перед отправкой, пожалуйста, убедись, что цена в геймпассе установлена ровно на <b>${passPrice} R$</b> 🪙\n\n` +
      `💡 <i>Пример ссылки:</i>\n` +
      `<code>https://www.roblox.com/game-pass/1234567/...</code>\n\n` +
      `💡 <i>Пример Asset ID:</i>\n` +
      `<code>1234567</code>`,
      {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(isAdmin ? getAdminKeyboard() : {})
      }
    );
  });
}

function getAdminKeyboard() {
  return Markup.keyboard([
    ["📊 Статистика", "🕒 Очередь"],
    ["📜 История", "🔑 Остаток кодов"]
  ]).resize();
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
  // --- Admin Menu Buttons (Fixed Keyboard) ---
  bot.hears("📊 Статистика", async (ctx) => {
    if (!ADMIN_IDS.includes(String(ctx.from.id))) return;
    await showAdminStats(ctx);
  });

  bot.hears("🕒 Очередь", async (ctx) => {
    if (!ADMIN_IDS.includes(String(ctx.from.id))) return;
    await showAdminQueue(ctx);
  });

  bot.hears("📜 История", async (ctx) => {
    if (!ADMIN_IDS.includes(String(ctx.from.id))) return;
    await showAdminHistory(ctx);
  });

  bot.hears("🔑 Остаток кодов", async (ctx) => {
    if (!ADMIN_IDS.includes(String(ctx.from.id))) return;
    await showAdminCodes(ctx);
  });

  // --- Main Text Handler ---
  bot.on("text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;

    const tgId = String(ctx.from.id);
    const isAdmin = ADMIN_IDS.includes(tgId);
    const text = ctx.message.text.trim();

    // 1. ADMIN REJECTION REASON flow
    const rejectOrderId = pendingRejectionReason.get(ctx.from.id);
    if (isAdmin && rejectOrderId) {
      pendingRejectionReason.delete(ctx.from.id);
      await performAdminReject(bot, ctx, rejectOrderId, text);
      return;
    }

    const state = pendingLink.get(ctx.from.id);

    // 2. ADMIN SEARCH
    // Run for admins whenever the text is NOT a recognisable gamepass URL/ID.
    // This covers the case where an admin has a pendingLink state (e.g. tested
    // an activation) but is now trying to search for an order — their search
    // query (order-ID suffix or WB code) won't parse as a gamepass, so we
    // route correctly. If admin intentionally sends a gamepass URL/numeric ID
    // while in an activation session, the gamepass handler runs instead.
    if (isAdmin) {
      const looksLikeGamepass = state && extractPassId(text) !== null;
      if (!looksLikeGamepass) {
        await handleAdminSearch(ctx, text);
        return;
      }
    }

    // 3. USER GAMEPASS LINK flow
    if (!state) return;

    const passId = extractPassId(text);

    if (!passId) {
      await ctx.reply(
        "⚠️ Не удалось распознать геймпасс.\n\n" +
        "Пришли одно из:\n" +
        "• Ссылку: <code>https://www.roblox.com/game-pass/1234567/...</code>\n" +
        "• Ссылку из конструктора: <code>https://create.roblox.com/...</code>\n" +
        "• Просто ID (только цифры): <code>1234567</code>",
        { parse_mode: "HTML" }
      );
      return;
    }

    // Re-check subscription — pendingLink state may have been set before subscribing.
    if (!isAdmin) {
      const subscribed = await checkSubscription(bot, ctx.from.id);
      if (!subscribed) {
        await ctx.reply(
          `💎 Почти готово! Подпишись на наш канал, чтобы отправить геймпасс.\n` +
          `Там мы публикуем секретные промокоды на робуксы: https://t.me/Roblox_Bank_Tg\n\n` +
          `Подписавшись, ты получишь доступ к:\n` +
          `1. 🏆 Приоритетной очереди выкупа.\n` +
          `2. 🎰 Розыгрышам робуксов каждый понедельник.\n` +
          `3. 💬 Моментальной поддержке 24/7.\n\n` +
          `После подписки просто отправь ссылку на геймпасс ещё раз.`,
          {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
            ...Markup.inlineKeyboard([[
              Markup.button.url("📢 Подписаться", "https://t.me/Roblox_Bank_Tg")
            ]]),
          }
        );
        return; // pendingLink preserved — user re-sends the link after subscribing
      }
    }

    // ── Roblox API validation ─────────────────────────────────────────────
    const expectedPrice = Math.ceil(state.denomination / 0.7);
    const gamepassInfo  = await getGamepassDetails(passId);

    if (!gamepassInfo) {
      // Roblox is reachable but returned no data → gamepass likely doesn't exist
      await ctx.reply(
        "⚠️ Не удалось получить информацию о геймпассе от Roblox.\n\n" +
        "Проверь правильность ссылки/ID и попробуй ещё раз. " +
        "Если проблема повторяется — обратись в поддержку.",
        { parse_mode: "HTML" }
      );
      return;
    }

    if (!gamepassInfo.validationSkipped) {
      // Normal validation — only runs when Roblox API was reachable
      if (!gamepassInfo.isActive) {
        await ctx.reply(
          `⚠️ Геймпасс №${passId} не выставлен на продажу.\n\n` +
          `Убедись, что он активен и доступен для покупки, затем пришли ссылку снова.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      if (Math.abs(gamepassInfo.price - expectedPrice) > 2) {
        await ctx.reply(
          `⚠️ Цена геймпасса не совпадает с ожидаемой.\n\n` +
          `Установлено: <b>${gamepassInfo.price} R$</b>\n` +
          `Ожидается:   <b>${expectedPrice} R$</b>\n\n` +
          `Измени цену геймпасса в настройках Roblox и пришли ссылку снова.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      // Notify user that the gamepass was found and validated
      const creatorLine = gamepassInfo.creatorName
        ? `\n👤 Создатель: ${gamepassInfo.creatorName}`
        : "";
      await ctx.reply(
        `✅ Геймпасс найден!` +
        creatorLine +
        `\n💰 Цена: ${gamepassInfo.price} R$`,
        { parse_mode: "HTML" }
      );
    } else {
      // Network-down fallback — log for audit, proceed to order creation
      console.warn(
        `[TG] Roblox API unreachable — accepting passId=${passId} without validation. ` +
        `Admin must verify price manually.`
      );
    }
    // ── End Roblox validation ─────────────────────────────────────────────

    const cleanLink = `https://www.roblox.com/game-pass/${passId}`;

    const user = await (db as any).user.findUnique({ where: { tgId: String(ctx.from.id) } });
    if (!user) {
      await ctx.reply("Ошибка сессии. Пожалуйста, пройди активацию кода повторно через /start.");
      return;
    }

    // ── Atomic claim + order creation ──────────────────────────────────────
    // Roblox validation passed above — now commit in a single transaction:
    //  1. Claim the code (userId:null covers both fresh and web-pre-activated codes)
    //  2. Create the order
    //  3. Clear bonus balance
    // If any step fails the whole transaction rolls back — the code stays unclaimed.
    let order: any;
    try {
      order = await (db as any).$transaction(async (tx: any) => {
        const claimed = await tx.wbCode.updateMany({
          where: {
            code:   { equals: state.wbCode, mode: "insensitive" },
            userId: null, // matches fresh (isUsed=false) AND web-activated (isUsed=true,userId=null)
          },
          data: { userId: user.id, isUsed: true, usedAt: new Date() },
        });
        console.log(
          `[TG] $transaction: wbCode.updateMany count=${claimed.count} for code=${state.wbCode}`
        );
        if (claimed.count === 0) {
          // Check whether the code already belongs to this user (retry after crash/resubmit)
          const existingCode = await tx.wbCode.findFirst({
            where: { code: { equals: state.wbCode, mode: "insensitive" } },
          });
          if (!existingCode || existingCode.userId !== user.id) {
            throw Object.assign(new Error("Code already claimed"), { isClaimed: true });
          }
          // Code already assigned to this user — allow retry, skip re-update
        }

        const newOrder = await tx.wbOrder.create({
          data: {
            amount:      state.denomination,
            gamepassUrl: cleanLink,
            status:      "PENDING",
            platform:    "TG",
            userId:      user.id,
            wbCode:      state.wbCode,
          },
        });

        if (user.balance && user.balance > 0) {
          await tx.user.update({ where: { id: user.id }, data: { balance: 0 } });
        }

        return newOrder;
      });
    } catch (err: any) {
      if (err.isClaimed) {
        pendingLink.delete(ctx.from.id);
        await ctx.reply("⚠️ Этот код уже был активирован другим пользователем. Обратитесь в поддержку.");
        return;
      }
      console.error("[TG] Order create error:", err);
      await ctx.reply("❌ Ошибка при создании заявки. Попробуй позже или напиши в поддержку.");
      return;
    }

    pendingLink.delete(ctx.from.id);

    await ctx.reply(
      `✅ Принял геймпасс №${passId}! Ожидайте выкупа.\n\n` +
      `🆔 Номер заявки: <code>${order.id.slice(-6).toUpperCase()}</code>\n` +
      `📊 Проверить статус в любой момент: /status`,
      { parse_mode: "HTML" }
    );

    // Notify all Telegram admins (non-fatal — errors don't affect user)
    try {
      const fullOrder = await (db as any).wbOrder.findUnique({
        where: { id: order.id },
        include: { user: true }
      });
      if (fullOrder) {
        const { text: cardText, reply_markup } = await renderOrderCard(fullOrder);
        for (const adminId of ADMIN_IDS) {
          try { await bot.telegram.sendMessage(adminId, cardText, { parse_mode: "HTML", reply_markup, link_preview_options: { is_disabled: true } }); } catch {}
        }
      }
    } catch (err) {
      console.error("[TG] Admin notify error:", err);
    }
  });
}

/** 
 * Universal renderer for the admin order card.
 * Returns text and reply_markup ready for ctx.reply or edit.
 */
async function renderOrderCard(order: any) {
  const shortId = order.id.slice(-6).toUpperCase();
  const passPrice = Math.ceil(order.amount / 0.7);
  const statusLabels: any = { PENDING: "⏳ В обработке", COMPLETED: "✅ Выполнен", REJECTED: "❌ Отклонён" };
  
  const dateStr = order.createdAt 
    ? new Date(order.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " МСК" 
    : "";

  // User profile link
  let userLabel = "Неизвестен";
  if (order.user) {
    if (order.user.vkId) {
      const vkName = order.user.name || "VK Пользователь";
      userLabel = `<a href="https://vk.com/id${order.user.vkId}">${vkName}</a>`;
    } else if (order.user.tgId) {
      const name = order.user.name || "Пользователь";
      userLabel = `<a href="tg://user?id=${order.user.tgId}">${name}</a> (ID: ${order.user.tgId})`;
    }
  }

  const reasonLine = order.status === "REJECTED" && order.rejectionReason
    ? `\n💬 Причина: <i>${order.rejectionReason}</i>`
    : "";

  const platformEmojis: Record<string, string> = { TG: "📱", VK: "📘", WEB: "🌐" };
  const platformEmoji = platformEmojis[order.platform] || "📦";

  const wbCode = await (db as any).wbCode.findUnique({ where: { code: order.wbCode } });
  const bonus = wbCode && order.amount > wbCode.denomination ? order.amount - wbCode.denomination : 0;
  const bonusLine = bonus > 0 ? `🎁 Использован бонус: <b>${bonus} R$</b>\n` : "";
  const reviewLine = wbCode?.reviewBonusClaimed ? `🌟 Отзыв: <b>Оставлен (+50 R$)</b>\n` : `🌟 Отзыв: <b>Нет</b>\n`;

  // Loyalty tag — subtract 1 to get count of orders BEFORE the current one
  const totalOrders = await (db as any).wbOrder.count({ where: { userId: order.userId } }).catch(() => 1);
  const prev = Math.max(0, totalOrders - 1);
  const loyaltyLine =
    prev >= 5 ? `👑 <b>VIP КЛИЕНТ (${prev} заказов)</b>\n` :
    prev >= 1 ? `🔄 <b>ПОВТОРНЫЙ КЛИЕНТ</b>\n`              :
    "";

  const text =
    `📦 <b>ЗАКАЗ #${shortId}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    loyaltyLine +
    `${platformEmoji} Источник: <b>${order.platform}</b>\n` +
    (dateStr ? `📅 Время: <b>${dateStr}</b>\n` : "") +
    `👤 Юзер: ${userLabel}\n` +
    bonusLine +
    reviewLine +
    `💎 Сумма: <b>${order.amount} R$</b> (Геймпасс: ${passPrice} R$)\n` +
    `🔑 Код ВБ: <code>${order.wbCode}</code>\n` +
    `📊 Статус: <b>${statusLabels[order.status] || order.status}</b>${reasonLine}\n\n` +
    `🔗 <a href="${order.gamepassUrl}">Открыть Gamepass</a>`;

  // Inline buttons only for PENDING orders
  const reply_markup = order.status === "PENDING" ? {
    inline_keyboard: [[
      { text: "✅ ВЫКУПЛЕНО", callback_data: CB.adminOk(order.id) },
      { text: "❌ ОШИБКА",    callback_data: `admin_reject_init:${order.id}` }
    ]]
  } : undefined;

  return { text, reply_markup };
}

/** Admin search logic by ID or WB Code */
async function handleAdminSearch(ctx: any, query: string) {
  const q = query.trim().toUpperCase();
  const lowerQ = query.trim().toLowerCase();
  
  // Try search by order ID (full or short suffix)
  let order = await (db as any).wbOrder.findFirst({
    where: { OR: [
      { id: lowerQ }, 
      { id: { endsWith: lowerQ } }
    ]},
    include: { user: true },
    orderBy: { createdAt: "desc" }
  });

  // Try search by WB code
  if (!order) {
    const wbCode = await (db as any).wbCode.findUnique({ where: { code: q } });
    if (wbCode) {
      order = await (db as any).wbOrder.findFirst({
        where: { wbCode: wbCode.code },
        include: { user: true },
        orderBy: { createdAt: "desc" }
      });
      if (!order) {
        return ctx.reply(`🔑 Код <b>${wbCode.code}</b> (${wbCode.denomination} R$) найден, но пока не привязан к заказу.`, { parse_mode: "HTML" });
      }
    }
  }

  if (order) {
    const { text, reply_markup } = await renderOrderCard(order);
    return ctx.reply(text, { parse_mode: "HTML", reply_markup, link_preview_options: { is_disabled: true } });
  }

  return ctx.reply("🔎 Ничего не найдено. Введи ID заказа (последние 6-8 символов) или код WB.");
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

  bot.on("document", async (ctx) => {
    await ctx.reply(
      "📸 Пожалуйста, отправь скриншот в виде фотографии (сжатым изображением), а не файлом (документом)."
    );
  });
}

export function registerAdmin(bot: Telegraf): void {
  bot.command("admin", async (ctx) => {
    const tgId = String(ctx.from.id);
    if (!ADMIN_IDS.includes(tgId)) {
      return ctx.reply(`⛔ Доступ запрещен. Ваш ID: <code>${tgId}</code>`, { parse_mode: "HTML" });
    }

    await ctx.reply(
      "🛠️ <b>Панель управления</b>\n\n" +
      "Меню команд теперь всегда доступно внизу экрана.\n" +
      "Также ты можешь отправить боту ID заказа или код ВБ для быстрого поиска.",
      getAdminKeyboard()
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Admin View Logics
// ─────────────────────────────────────────────────────────────────────────────

async function showAdminStats(ctx: any) {
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

  await ctx.reply(statsText, { parse_mode: "HTML" });
}

async function showAdminQueue(ctx: any) {
  const pending = await (db as any).wbOrder.findMany({
    where: { status: "PENDING" },
    include: { user: true },
    orderBy: { createdAt: "asc" },
    take: 15
  });

  if (pending.length === 0) {
    return ctx.reply("🕒 Очередь пуста. Все заказы выкуплены!");
  }

  let qText = `🕒 <b>ОЧЕРЕДЬ (${pending.length} заказов)</b>\n\n`;
  const buttons: any[] = [];

  pending.forEach((o: any, i: number) => {
    const shortId = o.id.slice(-6).toUpperCase();
    qText += `${i+1}. <code>${shortId}</code> — <b>${o.amount} R$</b>\n`;
    buttons.push({ text: `🔍 ${shortId}`, callback_data: `admin_view:${o.id}` });
  });

  const keyboard: any[][] = [];
  for (let i = 0; i < buttons.length; i += 3) {
    keyboard.push(buttons.slice(i, i + 3));
  }

  await ctx.reply(qText, { 
    parse_mode: "HTML", 
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showAdminHistory(ctx: any) {
  const history = await (db as any).wbOrder.findMany({
    where: { status: "COMPLETED" },
    include: { user: true },
    orderBy: { updatedAt: "desc" },
    take: 15
  });

  if (history.length === 0) {
    return ctx.reply("📜 История пуста.");
  }

  const codes = await (db as any).wbCode.findMany({
    where: { code: { in: history.map((h: any) => h.wbCode) } }
  });
  const codeMap = Object.fromEntries(codes.map((c: any) => [c.code, c]));

  let hText = `📜 <b>ПОСЛЕДНИЕ ВЫПОЛНЕННЫЕ</b>\n\n`;
  const buttons: any[] = [];

  history.forEach((o: any, i: number) => {
    const shortId = o.id.slice(-6).toUpperCase();
    const date = new Date(o.updatedAt).toLocaleDateString("ru-RU", { day: '2-digit', month: '2-digit' });
    const hasReview = codeMap[o.wbCode]?.reviewBonusClaimed;
    const reviewIcon = hasReview ? " 🌟" : "";

    hText += `${i+1}. <code>${shortId}</code> — <b>${o.amount} R$</b> (${date})${reviewIcon}\n`;
    buttons.push({ text: `🔍 ${shortId}`, callback_data: `admin_view:${o.id}` });
  });

  const keyboard: any[][] = [];
  for (let i = 0; i < buttons.length; i += 3) {
    keyboard.push(buttons.slice(i, i + 3));
  }

  await ctx.reply(hText, { 
    parse_mode: "HTML", 
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showAdminCodes(ctx: any) {
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
  await ctx.reply(cText, { parse_mode: "HTML" });
}

/** Helper to perform rejection logic for both text and button callbacks */
async function performAdminReject(bot: Telegraf, ctx: any, orderId: string, reason: string) {
  const tgId = String(ctx.from.id);
  const displayReason = reason.trim() || "не указана";
  
  try {
    const order = await (db as any).wbOrder.update({
      where: { id: orderId },
      data: { 
        status: "REJECTED", 
        rejectionReason: reason.trim() || null, 
        adminId: tgId 
      },
      include: { user: true }
    });

    const shortId = order.id.slice(-6).toUpperCase();
    await ctx.reply(`❌ <b>Заказ #${shortId} отклонён.</b>\nПричина: <i>${displayReason}</i>`, { parse_mode: "HTML" });

    if (order.user) {
      await notifyUserRejected(bot, order.user, order.id, displayReason, order.amount, order.wbCode);
    }
  } catch (err) {
    console.error("[TG] Reject error:", err);
    await ctx.reply("❌ Ошибка при отклонении заказа. Возможно, он был удален.");
  }
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
    if (data.startsWith("admin_ok:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const orderId = data.split(":")[1];
      const order = await (db as any).wbOrder.update({
        where: { id: orderId },
        data:  { status: "COMPLETED", adminId },
      });
      const user = await (db as any).user.findUnique({ where: { id: order.userId } });

      const editedText = `✅ <b>Выполнено админом ${adminTag}</b>\nЗаказ #${orderId.slice(-6).toUpperCase()} · ${order.amount} R$`;
      try { await ctx.editMessageText(editedText, { parse_mode: "HTML" }); } catch {}

      if (user) await notifyUserCompleted(bot, user, orderId, order.amount);
      await ctx.answerCbQuery("✅ Выполнено");
      return;
    }

    // ── ❌ admin_reject_init: ask for reason ─────────────────────────────────
    if (data.startsWith("admin_reject_init:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const orderId = data.split(":")[1];
      pendingRejectionReason.set(ctx.from.id, orderId);
      await ctx.reply(
        `⚠️ Введи причину отклонения для заказа <code>${orderId.slice(-6).toUpperCase()}</code>:`, 
        { 
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[
            Markup.button.callback("❌ Без причины", `admin_reject_none:${orderId}`)
          ]])
        }
      );
      await ctx.answerCbQuery();
      return;
    }

    // ── ❌ admin_reject_none: reject without reason ─────────────────────────
    if (data.startsWith("admin_reject_none:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const orderId = data.split(":")[1];
      pendingRejectionReason.delete(ctx.from.id); // cleanup if any
      await performAdminReject(bot, ctx, orderId, "");
      await ctx.answerCbQuery("Отклонено без причины");
      return;
    }

    // ── 🔄 user_resubmit: user wants to fix link ─────────────────────────────
    if (data.startsWith("user_resubmit:")) {
      const parts = data.split(":");
      const code = parts[1];
      const denomination = parseInt(parts[2]);
      
      pendingLink.set(ctx.from.id, { wbCode: code, denomination });
      const passPrice = Math.ceil(denomination / 0.7);
      
      await ctx.reply(
        `🔄 <b>Исправление ссылки</b>\n\n` +
        `💎 Номинал: <b>${denomination} R$</b>\n` +
        `Пришли нам <b>Asset ID</b>, либо <b>ссылку</b> на твой геймпасс. Перед отправкой, пожалуйста, убедись, что цена в геймпассе установлена ровно на <b>${passPrice} R$</b> 🪙\n\n` +
        `💡 <i>Пример ссылки:</i>\n` +
        `<code>https://www.roblox.com/game-pass/1234567/...</code>\n\n` +
        `💡 <i>Пример Asset ID:</i>\n` +
        `<code>1234567</code>`,
        { parse_mode: "HTML" }
      );
      await ctx.answerCbQuery();
      return;
    }

    // ── 🎁 review_ok: approve review bonus ───────────────────────────────
    // ── ❌ review_no: reject review bonus ────────────────────────────────
    if (data.startsWith("review_ok:") || data.startsWith("review_no:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
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

    // ── 🔍 admin_view: open full order card ────────────────────────────────
    if (data.startsWith("admin_view:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("Доступ запрещен");
      const orderId = data.split(":")[1];
      const order = await (db as any).wbOrder.findUnique({
        where: { id: orderId },
        include: { user: true }
      });
      if (!order) return ctx.answerCbQuery("Заказ не найден");
      
      const { text, reply_markup } = await renderOrderCard(order);
      await ctx.reply(text, { parse_mode: "HTML", reply_markup, link_preview_options: { is_disabled: true } });
      return ctx.answerCbQuery();
    }

    // ── 📊 admin_stats: stats for day/week ────────────────────────────────
    if (data === CB.adminStats) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("Доступ запрещен");
      await showAdminStats(ctx);
      return ctx.answerCbQuery();
    }

    // ── 🕒 admin_queue: list pending orders ────────────────────────────────
    if (data === CB.adminQueue) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("Доступ запрещен");
      await showAdminQueue(ctx);
      return ctx.answerCbQuery();
    }

    // ── 🔑 admin_codes: check remain codes ────────────────────────────────
    if (data === CB.adminCodes) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("Доступ запрещен");
      await showAdminCodes(ctx);
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
  const completedCount = await (db as any).wbOrder.count({
    where: { userId: user.id, status: "COMPLETED" }
  });

  let msg = `✅ Ваш заказ #${orderId.slice(-6).toUpperCase()} успешно выкуплен!\n` +
            `Робуксы поступят на ваш баланс через 5-7 дней (по правилам самого Roblox).\n\n`;

  if (completedCount === 1) {
    msg += `🎁 <b>Оставь отзыв и получи 50 R$!</b>\n` +
           `Напиши отзыв о покупке на Wildberries, сделай скриншот и отправь его прямо сюда (в виде <b>фотографии</b>, а не файлом). После проверки администратором мы сразу начислим бонус, который учтется при следующем заказе!`;
  } else {
    msg += `Спасибо, что выбираете нас! 💛`;
  }

  if (user.tgId) {
    try {
      await bot.telegram.sendMessage(user.tgId, msg, { parse_mode: "HTML" });
      if (completedCount === 1) pendingReview.set(parseInt(user.tgId), orderId);
    } catch {}
  } else if (user.vkId) {
    // VK bot will detect the COMPLETED state on next message; also notify directly
    // vkSend removes HTML tags via stripHtml
    await vkSend(user.vkId, stripHtml(msg));
  }
}

async function notifyUserRejected(
  bot: Telegraf,
  user: { tgId?: string | null; vkId?: string | null },
  orderId: string,
  reason: string,
  amount: number,
  wbCode: string
): Promise<void> {
  const shortId = orderId.slice(-6).toUpperCase();
  const reasonLine = reason && reason !== "не указана" 
    ? `💬 Причина: <i>${reason}</i>\n\n` 
    : "";

  const msg =
    `❌ <b>Ошибка в вашем заказе #${shortId}</b>\n\n` +
    reasonLine +
    `Нажми на кнопку ниже, чтобы отправить исправленную ссылку:`;

  if (user.tgId) {
    try { 
      await bot.telegram.sendMessage(user.tgId, msg, { 
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[
          Markup.button.callback("🔄 Исправить ссылку", `user_resubmit:${wbCode}:${amount}`)
        ]])
      }); 
    } catch {}
  } else if (user.vkId) {
    await vkSend(user.vkId, stripHtml(msg) + "\n\n(Чтобы исправить, просто отправьте новую ссылку на геймпасс в этот чат)");
  }
}
