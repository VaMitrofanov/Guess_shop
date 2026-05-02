/**
 * All Telegraf handler registrations for the TG bot.
 *
 * Import order matters: register command/text/photo handlers BEFORE the
 * generic fallback so Telegraf's middleware chain routes correctly.
 */

import { Telegraf, Markup } from "telegraf";
// telegraf/types re-exports the full typegram surface (official subpath export)
import type { User as TGUser } from "telegraf/types";
import { db, getCustomerStatus, getGreeting, getIdleGreeting } from "../shared/db";
import { vkSend, stripHtml } from "../shared/notify";
import { sendAdminOrderCard, sendAdminReviewCard, CB, ADMIN_IDS } from "../shared/admin";
import { pendingLink, pendingReview, pendingRejectionReason } from "./session";
import { getGamepassDetails } from "../shared/roblox";
import { buildAdminKeyboard, updateMainMenu, routeAdminCallback } from "./admin";
import { renderExtendedCard } from "./admin/hub-orders";

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
    const passed = ["member", "administrator", "creator"].includes(m.status);
    console.log(passed ? `[Gate] User ${userId} passed sub check` : `[Gate] User ${userId} failed sub check`);
    return passed;
  } catch (err) {
    console.error(`[Gate] getChatMember error for user ${userId}:`, err);
    return true; // fail-open: don't block users if the check itself fails
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// /start [CODE]
// ─────────────────────────────────────────────────────────────────────────────

const startRateLimiter = new Map<string, { attempts: number, resetAt: number }>();

export function registerStart(bot: Telegraf): void {
  bot.start(async (ctx) => {
    const tgId = String(ctx.from.id);
    const rawPayload = ctx.startPayload?.trim() ?? "";
    let code = rawPayload.toUpperCase();
    let sessionId: string | null = null;

    if (rawPayload.toLowerCase().startsWith("wb_")) {
      const parts = rawPayload.split("_");
      code = (parts[1] || "").toUpperCase();
      sessionId = parts[2] || null;
    }

    // Rate Limiting
    const rateKey = sessionId || tgId;
    const now = Date.now();
    const rateData = startRateLimiter.get(rateKey) || { attempts: 0, resetAt: now + 60000 };
    if (rateData.resetAt < now) {
      rateData.attempts = 0;
      rateData.resetAt = now + 60000;
    }
    rateData.attempts++;
    startRateLimiter.set(rateKey, rateData);
    if (rateData.attempts > 5) {
      console.warn(`[TG] Rate limit exceeded for start command by ${rateKey}`);
      if (rateData.attempts === 6) {
        await ctx.reply(
          "⏳ Ты уже активировал этот код. Подожди — бот обрабатывает заявку.\n\n" +
          "Если ждёшь больше 2 минут — напиши в поддержку: @RobloxBank_PA"
        );
      }
      return;
    }

    // No code payload — IDLE greeting
    if (!code) {
      const isAdmin = ADMIN_IDS.includes(tgId);
      const custStatus = await getCustomerStatus(tgId, "TG");
      const firstName = ctx.from.first_name || undefined;

      if (custStatus.isReturning && !isAdmin) {
        // IDLE state: upsell to direct sales, no gamepass instructions
        const idleMsg = getIdleGreeting(custStatus, firstName);
        await ctx.reply(
          `${idleMsg}\n\n📦 Статус заказа: /status`,
          { parse_mode: "HTML" }
        );
      } else {
        const greeting = getGreeting(custStatus, firstName);
        const kb = isAdmin ? await getAdminKeyboard() : {};
        await ctx.reply(
          `${greeting}Твой личный проводник в мир робуксов.\n\n` +
          `Для активации кода с карточки Wildberries перейди по ссылке на вкладыше.\n\n` +
          `📦 Статус заказа: /status`,
          kb
        );
      }
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

    if (wbCode.status === "CLAIMED" || (wbCode.isUsed && wbCode.userId != null)) {
      await ctx.reply("⚠️ Этот код уже был активирован ранее.");
      return;
    }

    if (wbCode.status === "RESERVED" && wbCode.sessionId && sessionId && wbCode.sessionId !== sessionId) {
      // SessionId mismatch — user likely opened the site on two devices. Since they
      // possess both the physical card and this deep link, proceed instead of blocking.
      console.warn(
        `[TG] SessionId mismatch for code=${code}: db=${wbCode.sessionId} link=${sessionId}. Proceeding.`
      );
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

    // ── Set pendingLink BEFORE the sub-gate ───────────────────────────────
    // The session must survive the "please subscribe" detour. If the gate fires
    // and the user later subscribes and sends a gamepass, registerText picks up
    // this state and processes it immediately — no silent dead-end.
    pendingLink.set(ctx.from.id, { wbCode: wbCode.code, denomination: totalAmount });

    const passPrice = Math.ceil(totalAmount / 0.7);

    // Subscription gate (optional — skip if TG_CHANNEL_ID not set)
    const subscribed = await checkSubscription(bot, ctx.from.id);
    if (!subscribed) {
      await ctx.reply(
        `✨ Почти готово! Чтобы мы могли моментально уведомлять тебя о выкупе и присылать секретные бонусы, загляни в наш канал: https://t.me/Roblox_Bank_Tg\n\n` +
        `Подпишись и просто пришли Asset ID или ссылку на геймпасс с ценой ровно <b>${passPrice} R$</b> — мы сразу возьмем его в работу! 💛`,
        {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          ...Markup.inlineKeyboard([[
            Markup.button.url("📢 Подписаться", "https://t.me/Roblox_Bank_Tg")
          ]]),
        }
      );
      return; // pendingLink preserved — user sends gamepass after subscribing
    }
    const isAdmin = ADMIN_IDS.includes(tgId);
    const adminKb = isAdmin ? await getAdminKeyboard() : {};

    // Loyalty-aware greeting for code activation
    const custStatus = await getCustomerStatus(tgId, "TG");
    const greetLine = getGreeting(custStatus, ctx.from.first_name || undefined);

    let bonusText = "";
    if (user.balance && user.balance > 0) {
      bonusText = `🎁 Использован бонус: <b>${user.balance} R$</b>\n` +
        `💎 Итого к выдаче: <b>${totalAmount} R$</b>\n\n`;
    } else {
      bonusText = `💎 Номинал: <b>${wbCode.denomination} R$</b>\n\n`;
    }

    await ctx.reply(
      `${greetLine}\n` +
      `✅ Код <b>${code}</b> активирован!\n` +
      bonusText +
      `Осталось совсем чуть-чуть — пришли <b>Asset ID</b> или <b>ссылку</b> на геймпасс.\n` +
      `📌 Убедись, что цена геймпасса ровно <b>${passPrice} R$</b>\n\n` +
      `Жду ссылку 👇`,
      {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(isAdmin ? adminKb : {})
      }
    );
  });
}

// Admin keyboard is now dynamic — see admin/menu.ts
let _cachedKeyboard: any = null;
async function getAdminKeyboard() {
  // Cache for 30s to avoid DB hits on every /start
  if (!_cachedKeyboard) {
    _cachedKeyboard = await buildAdminKeyboard();
    setTimeout(() => { _cachedKeyboard = null; }, 30_000);
  }
  return _cachedKeyboard;
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
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  if (!order) {
    return "У тебя пока нет заявок. Отправь ссылку на геймпасс, чтобы создать заявку.";
  }

  const label: Record<string, string> = {
    PENDING: "⏳ В обработке",
    IN_PROGRESS: "🔧 В работе",
    COMPLETED: "✅ Выполнен",
    REJECTED: "❌ Отклонён",
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
  // Admin menu buttons are now handled by admin/index.ts (registerAdminHubs).
  // The old hears handlers have been removed.

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
    if (!state) {
      if (!isAdmin) {
        // Gentle gate — unsubscribed user with no active code session
        if (process.env.TG_CHANNEL_ID) {
          const subbed = await checkSubscription(bot, ctx.from.id);
          if (!subbed) {
            await ctx.reply(
              `✨ Мы очень ждем твою заявку! Но чтобы система могла закрепить её за тобой и выдать робуксы, нужно сначала заглянуть в наш канал: https://t.me/Roblox_Bank_Tg\n\n` +
              `Как только подпишешься — присылай код или ссылку, и мы всё сделаем! 💛`,
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
        }
        
        // Fallback for subscribed users with no active session (fixes the "black hole")
        await ctx.reply(
          "У тебя сейчас нет активных заявок для ввода ссылки.\n\n" +
          "📦 Проверить статус старых заказов: /status\n" +
          "💬 Если нужна помощь — обратись в поддержку.",
          { parse_mode: "HTML" }
        );
      }
      return;
    }

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

    const expectedPrice = Math.ceil(state.denomination / 0.7);

    // Re-check subscription — pendingLink state may have been set before subscribing.
    if (!isAdmin) {
      const subscribed = await checkSubscription(bot, ctx.from.id);
      if (!subscribed) {
        await ctx.reply(
          `✨ Почти готово! Чтобы мы могли моментально уведомлять тебя о выкупе и присылать секретные бонусы, загляни в наш канал: https://t.me/Roblox_Bank_Tg\n\n` +
          `Подпишись и просто отправь ссылку на геймпасс за <b>${expectedPrice} R$</b> еще раз — мы сразу возьмем его в работу! 💛`,
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
    const gamepassInfo = await getGamepassDetails(passId);

    if (!gamepassInfo) {
      // Roblox returned HTTP responses but no usable data → gamepass doesn't exist
      await ctx.reply(
        "❌ Геймпасс не найден на Roblox.\n\n" +
        "Убедись, что:\n" +
        "• Геймпасс <b>опубликован</b> (не в черновиках)\n" +
        "• Ссылка ведёт именно на Game Pass, а не на саму игру\n" +
        "• Ты скопировал ссылку прямо из браузера Roblox\n\n" +
        "Если геймпасс точно существует — напиши в поддержку: @RobloxBank_PA",
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
            code: { equals: state.wbCode, mode: "insensitive" },
            OR: [
              { status: "RESERVED" },
              { userId: null }
            ]
          },
          data: { userId: user.id, isUsed: true, status: "CLAIMED", usedAt: new Date() },
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

        // Check if an order already exists for this WB code.
        // Since wbCode is @unique, we can only have one record per code.
        const existingOrder = await tx.wbOrder.findUnique({
          where: { wbCode: state.wbCode }
        });

        let newOrder;
        if (existingOrder) {
          if (existingOrder.status === "REJECTED") {
            // Allow resubmission: update the rejected order back to PENDING with the new link
            newOrder = await tx.wbOrder.update({
              where: { id: existingOrder.id },
              data: {
                gamepassUrl: cleanLink,
                status: "PENDING",
                rejectionReason: null,
                adminId: null, // Reset admin assignment
              },
            });
          } else {
            // Already processing or completed
            throw Object.assign(new Error("Order already exists"), { code: "P2002" });
          }
        } else {
          // Fresh order
          newOrder = await tx.wbOrder.create({
            data: {
              amount: state.denomination,
              gamepassUrl: cleanLink,
              status: "PENDING",
              platform: "TG",
              userId: user.id,
              wbCode: state.wbCode,
            },
          });
        }

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
      if (err.code === "P2002") {
        pendingLink.delete(ctx.from.id);
        await ctx.reply("⚠️ Заказ по этому коду уже был создан и сейчас обрабатывается.");
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
          try { await bot.telegram.sendMessage(adminId, cardText, { parse_mode: "HTML", reply_markup, link_preview_options: { is_disabled: true } }); } catch { }
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
  const statusLabels: any = { PENDING: "⏳ В обработке", IN_PROGRESS: "🔧 В работе", COMPLETED: "✅ Выполнен", REJECTED: "❌ Отклонён" };

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
      prev >= 1 ? `🔄 <b>ПОВТОРНЫЙ КЛИЕНТ</b>\n` :
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
      { text: "❌ ОШИБКА", callback_data: `admin_reject_init:${order.id}` }
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
    where: {
      OR: [
        { id: lowerQ },
        { id: { endsWith: lowerQ } }
      ]
    },
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
    const user = await (db as any).user.findUnique({ where: { tgId } });
    if (!user) return;

    // 1. Check in-memory state first (fastest path)
    let orderId = pendingReview.get(ctx.from.id);

    // 2. DB fallback: latest COMPLETED order whose review bonus is not yet claimed
    if (!orderId) {
      const order = await (db as any).wbOrder.findFirst({
        where: { userId: user.id, status: "COMPLETED" },
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
      userId: user.id as string,
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
      await getAdminKeyboard()
    );
  });
}

// Old admin view functions (showAdminStats, showAdminQueue, showAdminHistory,
// showAdminCodes) have been moved to admin/hub-*.ts modules.

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

    const data = cbq.data;
    const adminId = String(ctx.from.id);
    const adminTag = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "Админ";

    // ── Route to admin hub handlers first ─────────────────────────────────
    const hubHandled = await routeAdminCallback(bot, ctx, data, adminId);
    if (hubHandled) return;

    // ── ✅ admin_ok: order completed ──────────────────────────────────────
    if (data.startsWith("admin_ok:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const orderId = data.split(":")[1];

      // Snapshot purchase rate at fulfillment time
      const settings = await (db as any).globalSettings.findUnique({ where: { id: "global" } });
      const currentRate = settings?.purchaseRate ?? null;

      // Atomic guard: only update if the order is still in an actionable state.
      // Prevents double-notification when two admins click simultaneously.
      const updatedCount = await (db as any).wbOrder.updateMany({
        where: { id: orderId, status: { in: ["PENDING", "IN_PROGRESS"] } },
        data: { status: "COMPLETED", adminId, purchaseRate: currentRate },
      });

      if (updatedCount.count === 0) {
        await ctx.answerCbQuery("⚠️ Уже обработан другим админом");
        try {
          await ctx.editMessageText("✅ Выполнено (другим админом)", { parse_mode: "HTML" });
        } catch {}
        return;
      }

      const order = await (db as any).wbOrder.findUnique({ where: { id: orderId } });
      const user = await (db as any).user.findUnique({ where: { id: order.userId } });

      const editedText = `✅ <b>Выполнено админом ${adminTag}</b>\nЗаказ #${orderId.slice(-6).toUpperCase()} · ${order.amount} R$`;
      try { await ctx.editMessageText(editedText, { parse_mode: "HTML" }); } catch { }

      if (user) await notifyUserCompleted(bot, user, orderId, order.amount);
      await updateMainMenu(bot);
      await ctx.answerCbQuery("✅ Выполнено");
      return;
    }

    // ── ❌ admin_reject_init: safety confirmation step ─────────────────────────
    if (data.startsWith("admin_reject_init:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const orderId = data.split(":")[1];
      await ctx.reply(
        `⚠️ Отклонить заказ <code>${orderId.slice(-6).toUpperCase()}</code>?\n\nЭто действие уведомит пользователя.`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[
            Markup.button.callback("✅ Да, отклонить", `confirm_reject:${orderId}`),
            Markup.button.callback("❌ Отмена", `cancel_reject:${orderId}`),
          ]])
        }
      );
      await ctx.answerCbQuery();
      return;
    }

    // ── ✅ confirm_reject: confirmed → ask for reason ────────────────────────
    if (data.startsWith("confirm_reject:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const orderId = data.split(":")[1];
      pendingRejectionReason.set(ctx.from.id, orderId);
      try { await ctx.editMessageText(
        `⚠️ Введи причину отклонения для заказа <code>${orderId.slice(-6).toUpperCase()}</code>:`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[
            Markup.button.callback("❌ Без причины", `admin_reject_none:${orderId}`)
          ]])
        }
      ); } catch { }
      await ctx.answerCbQuery();
      return;
    }

    // ── ❌ cancel_reject: admin cancelled rejection ──────────────────────────
    if (data.startsWith("cancel_reject:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      try { await ctx.editMessageText("✅ Отклонение отменено."); } catch { }
      await ctx.answerCbQuery("Отменено");
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
    if (data.startsWith("review_ok:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const [, orderId, userId] = data.split(":");

      // Award +50 R$ and mark bonus as claimed
      await (db as any).user.update({
        where: { id: userId },
        data: { balance: { increment: 50 } },
      });
      await (db as any).wbCode.updateMany({
        where: { userId, reviewBonusClaimed: false },
        data: { reviewBonusClaimed: true },
      });

      const user = await (db as any).user.findUnique({ where: { id: userId } });
      const bonusMsg =
        `🎁 <b>+50 R$ зачислено на счёт!</b>\n` +
        `Спасибо за отзыв — бонус доступен при следующей покупке 💛`;

      if (user?.tgId) {
        try { await bot.telegram.sendMessage(user.tgId, bonusMsg, { parse_mode: "HTML" }); } catch { }
      } else if (user?.vkId) {
        await vkSend(user.vkId, stripHtml(bonusMsg));
      }

      const caption = `🎁 Бонус начислен — ${adminTag}\nЗаказ #${orderId.slice(-6).toUpperCase()}`;
      try { await ctx.editMessageCaption(caption, { parse_mode: "HTML" }); } catch { }
      await ctx.answerCbQuery("+50 R$ начислено");
      return;
    }

    // ── ❌ review_no: safety confirmation step ────────────────────────────
    if (data.startsWith("review_no:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const [, orderId, userId] = data.split(":");
      await ctx.reply(
        `⚠️ Отклонить скриншот отзыва для заказа <code>${orderId.slice(-6).toUpperCase()}</code>?\n\nПользователь будет уведомлён и сможет отправить скриншот повторно.`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[
            Markup.button.callback("✅ Да, отклонить", CB.confirmReviewReject(orderId, userId)),
            Markup.button.callback("❌ Отмена", CB.cancelReviewReject(orderId, userId)),
          ]])
        }
      );
      await ctx.answerCbQuery();
      return;
    }

    // ── ✅ confirm_rev_no: confirmed → show preset reasons ───────────────
    if (data.startsWith("confirm_rev_no:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const [, orderId, userId] = data.split(":");
      try { await ctx.editMessageText(
        `📋 Выбери причину отклонения:`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("📸 Скриншот нечёткий", CB.reviewRejectReason(orderId, userId, "blur"))],
            [Markup.button.callback("⏳ Отзыв ещё не опубликован", CB.reviewRejectReason(orderId, userId, "notpub"))],
            [Markup.button.callback("📦 Не тот товар", CB.reviewRejectReason(orderId, userId, "wrong"))],
          ])
        }
      ); } catch { }
      await ctx.answerCbQuery();
      return;
    }

    // ── ❌ cancel_rev_no: admin cancelled review rejection ───────────────
    if (data.startsWith("cancel_rev_no:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      try { await ctx.editMessageText("✅ Отклонение отзыва отменено."); } catch { }
      await ctx.answerCbQuery("Отменено");
      return;
    }

    // ── 📋 rev_reason: preset review rejection reason selected ───────────
    if (data.startsWith("rev_reason:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const parts = data.split(":");
      const orderId = parts[1];
      const userId  = parts[2];
      const key     = parts[3];

      const reasonMap: Record<string, string> = {
        blur:   "Скриншот нечёткий",
        notpub: "Отзыв ещё не опубликован",
        wrong:  "Не тот товар",
      };
      const reason = reasonMap[key] ?? key;

      // Update admin card
      const caption = `❌ Отзыв отклонён — ${adminTag}\nЗаказ #${orderId.slice(-6).toUpperCase()}\nПричина: ${reason}`;
      try { await ctx.editMessageText(caption, { parse_mode: "HTML" }); } catch { }

      // Notify user and restore review state
      await notifyReviewRejected(bot, userId, orderId, reason);

      await ctx.answerCbQuery(`Отклонено: ${reason}`);
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

    // Legacy admin_stats / admin_queue / admin_codes callbacks are now
    // handled by routeAdminCallback() above (hub system).


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
      } catch { }
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
  // Count includes the order just marked COMPLETED — satisfies "current order counts"
  const completedCount = await (db as any).wbOrder.count({
    where: { userId: user.id, status: "COMPLETED" }
  });

  let tgMsg: string;
  let vkMsg: string;

  if (completedCount === 1) {
    // TIER 1: First-Time Buyer — Review & Social Proof
    tgMsg =
      `✅ Заказ выкуплен! Робуксы придут через 5-7 дней.\n\n` +
      `🎁 <b>Оставь отзыв и получи 50 R$ в подарок!</b>\n` +
      `Напиши отзыв на Wildberries, сделай скриншот и отправь его сюда (фотографией, не файлом). После проверки администратором бонус начислим сразу!\n\n` +
      `Ты уже в нашем канале, так что не пропустишь секретные раздачи! 🎰`;
    vkMsg =
      `✅ Заказ выкуплен! Робуксы придут через 5-7 дней.\n\n` +
      `Оставь отзыв и получи 50 R$ в подарок!\n` +
      `Напиши отзыв на Wildberries, сделай скриншот и отправь его в этот чат. После проверки бонус начислим сразу!\n\n` +
      `Ты уже в нашем сообществе, так что не пропустишь секретные раздачи! 🎰`;
  } else {
    // TIER 2: Returning & VIP — Direct pitch to @RobloxBank_PA
    console.log(`[CRM] Direct pitch sent for order #${completedCount}`);
    tgMsg =
      `✅ Заказ выкуплен! Это уже твой <b>${completedCount}-й</b> заказ в RobloxBank. Спасибо за доверие! 💛\n\n` +
      `Кстати, для постоянных клиентов у нас есть закрытый формат. Чтобы не ждать поставок на Wildberries и оформлять заказы по самому выгодному курсу (без лишних комиссий), пиши нам в поддержку напрямую: @RobloxBank_PA\n\n` +
      `Это <b>быстрее, проще и всегда выгоднее</b>. Мы закрепим за тобой персональное обслуживание.\n\n` +
      `Всё ли было удобно в этот раз? Если есть идеи по улучшению — напиши в поддержку, мы читаем каждое сообщение!`;
    vkMsg =
      `✅ Заказ выкуплен! Это уже твой ${completedCount}-й заказ в RobloxBank. Спасибо за доверие! 💛\n\n` +
      `Кстати, для постоянных клиентов у нас есть закрытый формат. Чтобы не ждать поставок на Wildberries и оформлять заказы по самому выгодному курсу (без лишних комиссий), пиши нам в поддержку напрямую: t.me/RobloxBank_PA\n\n` +
      `Это быстрее, проще и всегда выгоднее. Мы закрепим за тобой персональное обслуживание.\n\n` +
      `Всё ли было удобно в этот раз? Если есть идеи по улучшению — напиши в поддержку, мы читаем каждое сообщение!`;
  }

  if (user.tgId) {
    try {
      await bot.telegram.sendMessage(user.tgId, tgMsg, { parse_mode: "HTML" });
      if (completedCount === 1) pendingReview.set(parseInt(user.tgId), orderId);
    } catch { }
  } else if (user.vkId) {
    await vkSend(user.vkId, vkMsg);
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
    } catch { }
  } else if (user.vkId) {
    await vkSend(user.vkId, stripHtml(msg) + "\n\n(Чтобы исправить, просто отправьте новую ссылку на геймпасс в этот чат)");
  }
}

/**
 * Notify a user that their review screenshot was rejected, and restore
 * the AWAITING_REVIEW state so they can immediately send a new one.
 */
async function notifyReviewRejected(
  bot: Telegraf,
  userId: string,
  orderId: string,
  reason: string
): Promise<void> {
  const user = await (db as any).user.findUnique({ where: { id: userId } });
  if (!user) return;

  const tgMsg =
    `❌ Ой, возникла проблемка с твоим отзывом!\n` +
    `Админ указал причину: <b>${reason}</b>.\n\n` +
    `Исправь это, пожалуйста, и пришли скриншот снова — бонус 50 R$ всё еще ждет тебя! 🎁`;

  const vkMsg =
    `❌ Ой, возникла проблемка с твоим отзывом!\n` +
    `Админ указал причину: ${reason}.\n\n` +
    `Исправь это, пожалуйста, и пришли скриншот снова — бонус 50 R$ всё еще ждет тебя! 🎁`;

  if (user.tgId) {
    try {
      await bot.telegram.sendMessage(user.tgId, tgMsg, { parse_mode: "HTML" });
      // Restore review state so the next photo from this user is processed
      pendingReview.set(parseInt(user.tgId), orderId);
    } catch { }
  } else if (user.vkId) {
    await vkSend(user.vkId, vkMsg);
    // Restore VK review state — lazy import to avoid circular deps
    try {
      const { setState } = await import("../vk/session");
      setState(parseInt(user.vkId), { type: "AWAITING_REVIEW", orderId });
    } catch { }
  }
}
