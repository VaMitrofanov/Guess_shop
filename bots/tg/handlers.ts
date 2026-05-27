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
import { vkSend, stripHtml, tgSend } from "../shared/notify";
import { sendAdminOrderCard, sendAdminReviewCard, sendAdminSupportAlert, sendAdminDirectOrderCard, sendAdminPaymentCard, CB, ADMIN_IDS, DIRECT_RATE, DIRECT_PACKS } from "../shared/admin";
import { pendingLink, pendingReview, pendingRejectionReason, linkFailCounts, pendingDirectAmount, pendingDirectOrder, pendingPaymentDetails, pendingPaymentScreenshot, type LinkFailState, type DirectOrderState } from "./session";
import { getGamepassDetails } from "../shared/roblox";
import { buildAdminKeyboard, updateMainMenu, routeAdminCallback } from "./admin";
import { renderExtendedCard } from "./admin/hub-orders";

// ── Constants ─────────────────────────────────────────────────────────────────

const SUPPORT_URL = "https://t.me/RobloxBank_PA";

/** Format a ruble amount with thousands separator, e.g. 3500 → "3 500 ₽". */
function fmtRub(n: number): string {
  if (n >= 1000) return `${Math.floor(n / 1000)} ${String(n % 1000).padStart(3, "0")} ₽`;
  return `${n} ₽`;
}

/** Build an inline keyboard with predefined Robux packs and their ruble prices. */
function buildPackKb() {
  const rows = [
    DIRECT_PACKS.slice(0, 3),  // 100, 200, 300
    DIRECT_PACKS.slice(3, 6),  // 500, 800, 1000
    DIRECT_PACKS.slice(6, 8),  // 2000, 5000
    DIRECT_PACKS.slice(8),     // 10000
  ] as number[][];
  const buttons = rows.map(row =>
    row.map(amt =>
      Markup.button.callback(
        `${amt} R$ — ${fmtRub(Math.round(amt * DIRECT_RATE))}`,
        CB.directPack(amt)
      )
    )
  );
  buttons.push([Markup.button.callback("❌ Отмена", CB.cancelDirect)]);
  return Markup.inlineKeyboard(buttons);
}

/** Generate a unique synthetic WB code for direct orders (never matches a real 7-char code). */
function generateDirectCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "DIR-";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── Support contact (Progressive Disclosure) ────────────────────────────────

/** Inline callback button that triggers support notification + shows contact URL. */
function supportBtn(label = "💬 Написать в поддержку", ctxKey = "general") {
  return Markup.button.callback(label, `sup:${ctxKey}`);
}

/** Returns an inlineKeyboard with a single support button row. */
function withSupportKb(label?: string, ctxKey = "general"): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([[supportBtn(label, ctxKey)]]);
}

/** Get or init the fail-counter object for a user's current session. */
function getFailCounts(userId: number): LinkFailState {
  if (!linkFailCounts.has(userId)) {
    linkFailCounts.set(userId, { priceMismatch: 0, formatError: 0, notActive: 0 });
  }
  return linkFailCounts.get(userId)!;
}

/** Clear fail counters when a session ends (success or new /start). */
function clearFailCounts(userId: number): void {
  linkFailCounts.delete(userId);
}

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
// Tracks users who recently sent /start with a code — suppresses the duplicate
// plain /start that iOS Telegram sends right after opening a deep link.
const recentCodeStarts = new Map<number, number>(); // userId → timestamp

export function registerStart(bot: Telegraf): void {
  bot.start(async (ctx) => {
    const tgId = String(ctx.from.id);
    const rawPayload = ctx.startPayload?.trim() ?? "";
    let code = rawPayload.toUpperCase();
    let sessionId: string | null = null;
    let isGuideMode = false;

    if (rawPayload.toLowerCase().startsWith("wbg_")) {
      const parts = rawPayload.split("_");
      code = (parts[1] || "").toUpperCase();
      sessionId = parts[2] || null;
      isGuideMode = true;
    } else if (rawPayload.toLowerCase().startsWith("wb_")) {
      const parts = rawPayload.split("_");
      code = (parts[1] || "").toUpperCase();
      sessionId = parts[2] || null;
    }

    // If this /start carries a code, mark the user immediately so a concurrent
    // plain /start (iOS deep-link duplicate) is suppressed below.
    if (code) {
      recentCodeStarts.set(ctx.from.id, Date.now());
      setTimeout(() => recentCodeStarts.delete(ctx.from.id), 30_000);
    }

    // Rate Limiting
    const rateKey = sessionId || tgId;
    const now = Date.now();
    if (startRateLimiter.size > 500) {
      for (const [k, v] of startRateLimiter) { if (v.resetAt < now) startRateLimiter.delete(k); }
    }
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
          "⏳ Слишком много попыток — подожди минуту и попробуй снова.",
          { parse_mode: "HTML", ...withSupportKb("💬 Нужна помощь?") }
        );
      }
      return;
    }

    // No code payload — IDLE greeting
    if (!code) {
      // Suppress the duplicate plain /start that iOS Telegram sends after a deep link
      const recentTs = recentCodeStarts.get(ctx.from.id);
      if (recentTs && Date.now() - recentTs < 15_000) return;
      const isAdmin = ADMIN_IDS.includes(tgId);
      const custStatus = await getCustomerStatus(tgId, "TG");
      const firstName = ctx.from.first_name || undefined;

      if (custStatus.isReturning && !isAdmin) {
        // IDLE state: upsell to direct sales, no gamepass instructions
        const idleMsg = getIdleGreeting(custStatus, firstName);
        await ctx.reply(
          idleMsg,
          {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
            ...Markup.inlineKeyboard([
              [Markup.button.callback("💎 Купить напрямую", CB.startDirect)],
              [Markup.button.callback("📊 Проверить статус", CB.refreshStatus)],
              [supportBtn("💬 Написать менеджеру")],
            ]),
          }
        );
      } else if (isAdmin) {
        const greeting = getGreeting(custStatus, firstName);
        const adminKb = await getAdminKeyboard();
        await ctx.reply(
          `${greeting}Твой личный проводник в мир робуксов.\n\n` +
          `Есть код с WB-карты? Напиши его прямо сюда — я всё оформлю.`,
          adminKb
        );
      } else {
        const greeting = getGreeting(custStatus, firstName);
        await ctx.reply(
          `${greeting}Твой личный проводник в мир робуксов.\n\n` +
          `Есть код с WB-карты? Напиши его прямо сюда — больше ничего не нужно.`,
          {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
            ...Markup.inlineKeyboard([
              [Markup.button.url("📖 Инструкция по активации", "https://robloxbank.ru/guide?source=wb")],
              [Markup.button.callback("💎 Купить напрямую", CB.startDirect)],
              [Markup.button.callback("📊 Проверить статус", CB.refreshStatus)],
            ]),
          }
        );
      }
      return;
    }

    // Case-insensitive code lookup (handles any stored-case variations)
    const wbCode = await (db as any).wbCode.findFirst({
      where: { code: { equals: code, mode: "insensitive" } },
    });
    if (!wbCode) {
      await ctx.reply(
        "❌ Код не найден. Проверь правильность ввода.\n\nЕсли уверен, что код верный — напиши нам: @RobloxBank_PA",
        { parse_mode: "HTML", ...withSupportKb(undefined, "code_not_found") }
      );
      return;
    }

    // Block only when the code was actually completed in the bot (isUsed + userId set).
    // isUsed=true with userId=null means the website reserved it but the bot flow
    // never finished — allow those through so users aren't silently stuck.
    if (wbCode.isUsed && wbCode.userId) {
      await ctx.reply("⚠️ Этот код уже был активирован ранее.", { parse_mode: "HTML", ...withSupportKb("💬 Это не мой заказ?", "code_mine") });
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

    // If code is CLAIMED by a different user, block
    if (wbCode.status === "CLAIMED" && wbCode.userId && wbCode.userId !== user.id) {
      await ctx.reply("⚠️ Этот код уже был активирован другим пользователем.", { parse_mode: "HTML", ...withSupportKb("💬 Оспорить — написать нам", "code_claimed") });
      return;
    }

    const totalAmount = wbCode.denomination + (user.balance || 0);

    // ── Set pendingLink BEFORE the sub-gate ───────────────────────────────
    // The session must survive the "please subscribe" detour. If the gate fires
    // and the user later subscribes and sends a gamepass, registerText picks up
    // this state and processes it immediately — no silent dead-end.
    pendingLink.set(ctx.from.id, { wbCode: wbCode.code, denomination: totalAmount });
    clearFailCounts(ctx.from.id); // fresh session — reset progressive disclosure counters
    pendingRejectionReason.delete(ctx.from.id); // discard any in-flight admin rejection reason

    const passPrice = Math.ceil(totalAmount / 0.7);

    // ── Provisional order: claim code + notify admins BEFORE any gates ───────────
    // Must happen first so we always capture user identity even if they skip
    // the subscription step or close Telegram immediately after landing.
    let provisionalOrder: any = null;
    try {
      provisionalOrder = await (db as any).$transaction(async (tx: any) => {
        const existingOrder = await tx.wbOrder.findUnique({ where: { wbCode: code } });
        if (existingOrder) return existingOrder; // re-activation — order already exists
        await tx.wbCode.update({
          where: { code },
          data: { userId: user.id, status: "CLAIMED", isUsed: false },
        });
        return tx.wbOrder.create({
          data: {
            amount: totalAmount,
            gamepassUrl: null,
            status: "AWAITING_GAMEPASS",
            platform: "TG",
            userId: user.id,
            wbCode: code,
          },
        });
      });
    } catch (err) {
      console.error("[TG] Provisional order creation failed:", err);
    }

    // Admin notification — sent immediately so we have contact data regardless of sub gate
    if (provisionalOrder && provisionalOrder.status === "AWAITING_GAMEPASS") {
      try {
        const tgDisplay = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || "Пользователь");
        const dateStr = new Date().toLocaleString("ru-RU", {
          timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit",
          year: "numeric", hour: "2-digit", minute: "2-digit",
        }) + " МСК";
        const notifyText =
          `📥 <b>НОВЫЙ КЛИЕНТ</b>\n` +
          `━━━━━━━━━━━━━━━━\n` +
          (isGuideMode ? `📖 Режим: <b>Инструкция</b>\n` : ``) +
          `📅 Время: <b>${dateStr}</b>\n` +
          `👤 Юзер: <a href="tg://user?id=${ctx.from.id}">${tgDisplay}</a> (ID: ${ctx.from.id})\n` +
          `💎 Сумма: <b>${totalAmount} R$</b> (Геймпасс: ${passPrice} R$)\n` +
          `🔑 Код ВБ: <code>${code}</code>\n` +
          `📊 Статус: ⌛ Ожидаем ссылку на геймпасс`;

        for (const adminId of ADMIN_IDS) {
          try {
            await bot.telegram.sendMessage(adminId, notifyText, {
              parse_mode: "HTML",
              link_preview_options: { is_disabled: true },
            });
          } catch { /* non-fatal */ }
        }

        const tgChatId = process.env.TG_CHAT_ID?.split(",")[0]?.trim();
        if (tgChatId && !ADMIN_IDS.includes(tgChatId)) {
          await tgSend(tgChatId, notifyText).catch((e) =>
            console.warn("[TG] provisional notify to TG_CHAT_ID failed:", e?.message)
          );
        }
      } catch (err) {
        console.error("[TG] Admin provisional notify error:", err);
      }
    }

    // ── Subscription gate (optional — skip if TG_CHANNEL_ID not set) ─────────────
    // Order is already created above — user data is captured even if they bail here.
    const subscribed = await checkSubscription(bot, ctx.from.id);
    if (!subscribed) {
      const subText = isGuideMode
        ? `🎉 Код <b>${code}</b> принят!\n\n` +
          `Ты в одном шаге — у наших клиентов есть закрытый канал: там первыми узнают о статусе заказа, ` +
          `получают бонусы на следующий заказ и эксклюзивные акции.\n\n` +
          `👇 Загляни — это бесплатно:\n` +
          `https://t.me/Roblox_Bank_Tg\n\n` +
          `После этого возвращайся за инструкцией 👉 https://www.robloxbank.ru/guide?source=wb&skip=1&code=${code}`
        : `🎉 Код <b>${code}</b> принят!\n\n` +
          `Ты в одном шаге — у наших клиентов есть закрытый канал: там первыми узнают о выкупе, ` +
          `получают бонусы на следующий заказ и эксклюзивные акции.\n\n` +
          `👇 Загляни — это бесплатно:\n` +
          `https://t.me/Roblox_Bank_Tg\n\n` +
          `После подписки бот напишет тебе автоматически — ничего дополнительно делать не нужно.\n` +
          `Если сообщение не пришло — просто напиши сюда любое слово 👋`;
      await ctx.reply(subText, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...Markup.inlineKeyboard([[
          Markup.button.url("⭐ Стать участником", "https://t.me/Roblox_Bank_Tg")
        ]]),
      });
      return;
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
      (isGuideMode
        ? `✅ Код <b>${code}</b> активирован!\n` +
          bonusText +
          `Теперь создай геймпасс в Roblox и пришли на него ссылку сюда.\n` +
          `📌 Цена геймпасса должна быть ровно <b>${passPrice} R$</b>\n\n` +
          `Если геймпасс уже создан — пришли ссылку прямо сюда 👇\n\n` +
          `Нужна инструкция?\n` +
          `👉 https://www.robloxbank.ru/guide?source=wb&skip=1&code=${code}`
        : `✅ Код <b>${code}</b> активирован!\n` +
          bonusText +
          `Теперь создай геймпасс в Roblox и пришли на него ссылку сюда.\n` +
          `📌 Цена геймпасса должна быть ровно <b>${passPrice} R$</b>\n` +
          `<i>(это номинал ÷ 0.7 — Roblox удерживает 30% комиссии)</i>\n\n` +
          `❓ Что такое геймпасс и как его создать — в инструкции:\n` +
          `👉 https://www.robloxbank.ru/guide?source=wb&skip=1&code=${code}\n\n` +
          `Пришли ссылку на геймпасс прямо сюда 👇`
      ),
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
    const { text, keyboard } = await buildStatusMessage(String(ctx.from.id));
    await ctx.reply(text, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...keyboard,
    });
  });
}

interface StatusMessage {
  text: string;
  keyboard: ReturnType<typeof Markup.inlineKeyboard>;
}

/** Builds /status text + keyboard. Shows support button when PENDING > 60 min. */
async function buildStatusMessage(tgId: string): Promise<StatusMessage> {
  const refreshRow = [Markup.button.callback("🔄 Обновить", CB.refreshStatus)];

  const user = await (db as any).user.findUnique({ where: { tgId } });
  if (!user) {
    return {
      text: "Привет! Есть WB-карта — напиши код прямо сюда или открой инструкцию.\n\nХочешь купить Robux напрямую без карты — нажми кнопку ниже.",
      keyboard: Markup.inlineKeyboard([
        [Markup.button.url("📖 Инструкция", "https://robloxbank.ru/guide?source=wb")],
        [Markup.button.callback("💎 Купить напрямую", CB.startDirect)],
        refreshRow,
      ]),
    };
  }

  const order = await (db as any).wbOrder.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  if (!order) {
    return {
      text: "Есть код с WB-карты? Напиши его прямо сюда — и начнём!\n\nИли купи Robux напрямую без карты 👇",
      keyboard: Markup.inlineKeyboard([
        [Markup.button.callback("💎 Купить напрямую", CB.startDirect)],
        refreshRow,
        [supportBtn("💬 Нужна помощь?")],
      ]),
    };
  }

  const label: Record<string, string> = {
    AWAITING_PAYMENT:  "⏳ Ожидаем реквизиты",
    PAYMENT_PENDING:   "💳 Ожидаем оплату",
    AWAITING_GAMEPASS: "⌛ Ожидаем геймпасс",
    PENDING:     "⏳ В обработке",
    IN_PROGRESS: "🔧 В работе",
    COMPLETED:   "✅ Выполнен",
    REJECTED:    "❌ Отклонён",
  };

  const pendingAgeMs = Date.now() - new Date(order.createdAt).getTime();
  const pendingOver60  = order.status === "PENDING" && pendingAgeMs > 60  * 60 * 1000;
  const pendingOver120 = order.status === "PENDING" && pendingAgeMs > 120 * 60 * 1000;

  // Progressive note per status
  let note = "";
  if (order.status === "AWAITING_PAYMENT") {
    const waitMins = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60_000);
    note = waitMins >= 15
      ? "\n\n⏰ <i>Реквизиты ещё не пришли. Если прошло больше 15 минут — напиши нам.</i>"
      : "\n\n💡 <i>Менеджер скоро пришлёт реквизиты для оплаты.</i>";
  } else if (order.status === "PAYMENT_PENDING") {
    note = "\n\n💳 <i>Пришли скриншот оплаты сюда (фотографией, не файлом).</i>";
  } else if (order.status === "AWAITING_GAMEPASS") {
    note = "\n\n💡 <i>Пришли ссылку на геймпасс прямо сюда — и мы сразу возьмём в работу!</i>";
  } else if (order.status === "PENDING") {
    if (pendingOver120) {
      note = "\n\n⏰ <i>Заявка обрабатывается дольше обычного. Если нужна помощь — напиши нам.</i>";
    } else if (pendingOver60) {
      note = "\n\n💬 <i>Обработка занимает чуть дольше обычного — скоро возьмём в работу.</i>";
    } else {
      note = "\n\n💬 <i>Менеджеры работают в порядке очереди — обычно выкупаем в течение нескольких часов, максимум сутки. " +
             "Мы сами пришлём уведомление когда всё будет готово.</i>";
    }
  } else if (order.status === "IN_PROGRESS") {
    note = "\n\n🔧 <i>Менеджер уже занимается твоим геймпассом — скоро пришлём уведомление.</i>";
  } else if (order.status === "REJECTED") {
    if (order.isDirectOrder) {
      note = order.rejectionReason
        ? `\n\n💬 Причина: <i>${order.rejectionReason}</i>\n\nЕсли хочешь — оформи новый заказ.`
        : `\n\nЕсли хочешь — оформи новый заказ ниже.`;
    } else {
      note = order.rejectionReason
        ? `\n\n💬 Причина: <i>${order.rejectionReason}</i>\n\nНажми кнопку ниже, чтобы исправить ссылку.`
        : `\n\nНажми кнопку ниже, чтобы исправить ссылку на геймпасс.`;
    }
  } else if (order.status === "COMPLETED") {
    note = "\n\n🚀 <i>Хочешь заказать ещё? Постоянным клиентам — прямое обслуживание без Wildberries по лучшему курсу!</i>";
  }

  const gamepassLine = order.gamepassUrl
    ? `🔗 <a href="${order.gamepassUrl}">Геймпасс</a>\n`
    : ``;

  const text =
    `📦 <b>Заявка #${order.id.slice(-6).toUpperCase()}</b>\n` +
    `📅 ${new Date(order.createdAt).toLocaleDateString("ru-RU")}\n` +
    `💎 Номинал: <b>${order.amount} R$</b>\n` +
    gamepassLine +
    `📊 Статус: <b>${label[order.status] ?? order.status}</b>` +
    note;

  // Keyboard varies by status
  let keyboard: ReturnType<typeof Markup.inlineKeyboard>;
  if (order.status === "AWAITING_PAYMENT" || order.status === "PAYMENT_PENDING") {
    const waitMins = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60_000);
    const supportRow = waitMins >= 15
      ? [supportBtn("⏰ Написать менеджеру", "direct_wait")]
      : [supportBtn("💬 Нужна помощь?", "direct_wait")];
    keyboard = Markup.inlineKeyboard([refreshRow, supportRow]);
  } else if (order.status === "REJECTED") {
    if (order.isDirectOrder) {
      keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("💎 Заказать напрямую", CB.startDirect)],
        refreshRow,
        [supportBtn("💬 Нужна помощь?", "rejected")],
      ]);
    } else {
      keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Исправить ссылку", `user_resubmit:${order.wbCode}:${order.amount}`)],
        refreshRow,
        [supportBtn("Нужна помощь?", "rejected")],
      ]);
    }
  } else if (order.status === "AWAITING_GAMEPASS") {
    const guideUrl = order.isDirectOrder
      ? `https://www.robloxbank.ru/guide?source=direct`
      : `https://www.robloxbank.ru/guide?source=wb&skip=1&code=${order.wbCode}`;
    keyboard = Markup.inlineKeyboard([
      [Markup.button.url("📖 Инструкция по созданию геймпасса", guideUrl)],
      refreshRow,
      [supportBtn("💬 Нужна помощь?", "general")],
    ]);
  } else if (order.status === "COMPLETED") {
    keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("💎 Заказать напрямую", CB.startDirect)],
      refreshRow,
    ]);
  } else if (pendingOver60) {
    keyboard = Markup.inlineKeyboard([refreshRow, [supportBtn("Нужна помощь?", "pending_long")]]);
  } else {
    keyboard = Markup.inlineKeyboard([refreshRow]);
  }

  return { text, keyboard };
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

    // 1a. ADMIN PAYMENT DETAILS flow
    const paymentDetailsOrderId = pendingPaymentDetails.get(ctx.from.id);
    if (isAdmin && paymentDetailsOrderId) {
      pendingPaymentDetails.delete(ctx.from.id);
      const dirOrder = await (db as any).wbOrder.findUnique({ where: { id: paymentDetailsOrderId } });
      if (!dirOrder) {
        await ctx.reply("❌ Заказ не найден.", { parse_mode: "HTML" });
        return;
      }
      await (db as any).wbOrder.update({
        where: { id: paymentDetailsOrderId },
        data: { paymentDetails: text, status: "PAYMENT_PENDING" },
      });
      const shortId = dirOrder.id.slice(-6).toUpperCase();
      const payUser = await (db as any).user.findUnique({ where: { id: dirOrder.userId } });
      if (payUser?.tgId) {
        try {
          await bot.telegram.sendMessage(
            payUser.tgId,
            `💳 <b>Реквизиты для оплаты заказа #${shortId}:</b>\n\n` +
            `<code>${text}</code>\n\n` +
            `Переведи деньги и пришли скриншот подтверждения сюда (фотографией, не файлом) 👇`,
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [[{ text: "📊 Проверить статус", callback_data: CB.refreshStatus }]],
              },
            }
          );
          pendingPaymentScreenshot.set(parseInt(payUser.tgId), dirOrder.id);
        } catch { }
      } else if (payUser?.vkId) {
        try {
          await vkSend(payUser.vkId,
            `💳 Реквизиты для оплаты заказа #${shortId}:\n\n` +
            `${text}\n\n` +
            `Переведи деньги и пришли скриншот подтверждения сюда (фотографией, не файлом) 👇`
          );
        } catch { }
      }
      await ctx.reply(`✅ Реквизиты отправлены пользователю (Заказ #${shortId})`, { parse_mode: "HTML" });
      return;
    }

    // 1b. USER DIRECT ORDER AMOUNT input
    if (!isAdmin && pendingDirectAmount.has(ctx.from.id)) {
      const num = parseInt(text.replace(/[\s,]/g, ""), 10);
      if (isNaN(num) || num < 100 || num > 10000) {
        pendingDirectAmount.set(ctx.from.id, true);
        await ctx.reply(
          "⚠️ Введи число от 100 до 10 000.\n\nНапример: <code>500</code>",
          { parse_mode: "HTML" }
        );
        return;
      }
      pendingDirectAmount.delete(ctx.from.id);
      const dirUser = await (db as any).user.findUnique({
        where: { tgId },
        select: { balance: true },
      });
      const bonus = dirUser?.balance ?? 0;
      const totalAmount = num + bonus;
      const passPrice = Math.ceil(totalAmount / 0.7);
      const rublePrice = Math.round(num * DIRECT_RATE);
      pendingDirectOrder.set(ctx.from.id, { amount: num, passPrice, totalAmount });
      const bonusSection = bonus > 0
        ? `💎 Запрос:          ${num} R$\n` +
          `🎁 Твой бонус:     +${bonus} R$\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `📦 Итого получишь:  ${totalAmount} R$\n`
        : `📦 Получишь:       ${totalAmount} R$\n`;
      await ctx.reply(
        `✅ <b>Подтверди заказ</b>\n\n` +
        bonusSection +
        `💰 К оплате:       ${fmtRub(rublePrice)}\n` +
        `📌 Цена геймпасса:  ${passPrice} R$`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[
            Markup.button.callback("✅ Подтвердить", CB.confirmDirect),
            Markup.button.callback("❌ Отмена", CB.cancelDirect),
          ]]),
        }
      );
      return;
    }

    let state = pendingLink.get(ctx.from.id);

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
              `⭐ У наших клиентов есть закрытый канал — там уведомления о статусе заказа, ` +
              `бонусы и акции.\n\nЗагляни, это бесплатно:\n` +
              `https://t.me/Roblox_Bank_Tg`,
              {
                parse_mode: "HTML",
                link_preview_options: { is_disabled: true },
                ...Markup.inlineKeyboard([[
                  Markup.button.url("⭐ Стать участником", "https://t.me/Roblox_Bank_Tg")
                ]]),
              }
            );
            return;
          }
        }

        // DB-based session recovery — runs for ANY text, not just gamepass URLs.
        // This ensures users who type "привет" or "что делать" after bot restart
        // still get a meaningful response instead of "no active orders".
        const tgUser = await (db as any).user.findUnique({
          where: { tgId },
          select: { id: true, balance: true },
        });

        if (tgUser) {
          // 1. AWAITING_GAMEPASS — restore session
          const awaitingOrder = await (db as any).wbOrder.findFirst({
            where: { userId: tgUser.id, status: "AWAITING_GAMEPASS" },
            orderBy: { createdAt: "desc" },
          });
          if (awaitingOrder) {
            state = { wbCode: awaitingOrder.wbCode, denomination: awaitingOrder.amount };
            pendingLink.set(ctx.from.id, state);

            // If text is not a gamepass URL, remind user what to do next
            if (extractPassId(text) === null) {
              const passPrice = Math.ceil(state.denomination / 0.7);
              await ctx.reply(
                `Продолжаем! Твой код уже активирован.\n\n` +
                `Осталось создать геймпасс и прислать сюда ссылку.\n` +
                `📌 Цена геймпасса: <b>${passPrice} R$</b>\n\n` +
                `Нужна инструкция? 👉 https://www.robloxbank.ru/guide?source=wb&skip=1&code=${state.wbCode}`,
                {
                  parse_mode: "HTML",
                  link_preview_options: { is_disabled: true },
                  ...Markup.inlineKeyboard([
                    [Markup.button.url("📖 Открыть инструкцию", `https://www.robloxbank.ru/guide?source=wb&skip=1&code=${state.wbCode}`)],
                    [supportBtn("💬 Нужна помощь?")],
                  ]),
                }
              );
              return;
            }
            // Text is a gamepass URL — fall through to processing below
          }

          // 2. WB code direct entry — check BEFORE rejected order so a new code is never blocked
          if (!state && /^[A-Za-z0-9]{7}$/.test(text) && /[A-Za-z]/.test(text)) {
            await handleWbCodeTextEntry(bot, ctx, tgId, text);
            return;
          }

          // 3. REJECTED order — guide user to resubmit
          if (!state) {
            const rejectedOrder = await (db as any).wbOrder.findFirst({
              where: { userId: tgUser.id, status: "REJECTED" },
              orderBy: { updatedAt: "desc" },
            });
            if (rejectedOrder) {
              const reasonLine = rejectedOrder.rejectionReason
                ? `\n💬 Причина: <i>${rejectedOrder.rejectionReason}</i>\n`
                : "";
              await ctx.reply(
                `❌ Заявка была отклонена.` + reasonLine + `\nИсправь геймпасс и нажми кнопку:`,
                {
                  parse_mode: "HTML",
                  ...Markup.inlineKeyboard([
                    [Markup.button.callback("🔄 Исправить ссылку", `user_resubmit:${rejectedOrder.wbCode}:${rejectedOrder.amount}`)],
                    [supportBtn("💬 Нужна помощь?")],
                  ]),
                }
              );
              return;
            }
          }
        }

        // If user typed a WB code directly (7 alphanumeric chars with at least one letter)
        if (!state && /^[A-Za-z0-9]{7}$/.test(text) && /[A-Za-z]/.test(text)) {
          await handleWbCodeTextEntry(bot, ctx, tgId, text);
          return;
        }

        if (!state) {
          // User may have clicked "📸 Оставить отзыв" and typed instead of sending a photo
          if (pendingReview.has(ctx.from.id)) {
            await ctx.reply(
              "📸 Жду скриншот отзыва — отправь его фотографией (не файлом, не документом).\n\n" +
              "Просто прикрепи изображение как обычное фото в Telegram.",
              { parse_mode: "HTML", ...withSupportKb("💬 Нужна помощь?") }
            );
            return;
          }
          await ctx.reply(
            "У тебя сейчас нет активных заявок.\n\n" +
            "🔑 Есть код с WB-карты? Напиши его прямо сюда.\n" +
            "💎 Хочешь заказать без карты — нажми кнопку ниже.",
            {
              parse_mode: "HTML",
              ...Markup.inlineKeyboard([
                [Markup.button.callback("💎 Купить напрямую", CB.startDirect)],
                [Markup.button.callback("📊 Проверить статус", CB.refreshStatus)],
                [supportBtn("Нужна помощь?")],
              ]),
            }
          );
          return;
        }
      } else {
        return;
      }
    }

    // ── Subscription gate — BEFORE parsing the link ──────────────────────
    // Check first so the user never sees "Получил!" before subscribing.
    // pendingLink is preserved; after joining the channel registerChatMember
    // will prompt the user to re-send the link.
    if (!isAdmin && process.env.TG_CHANNEL_ID) {
      const subscribed = await checkSubscription(bot, ctx.from.id);
      if (!subscribed) {
        await ctx.reply(
          `Чтобы оформить заказ, сначала подпишись на наш канал — там бонусы и акции для клиентов.\n\n` +
          `После подписки бот напишет тебе сам. Или пришли ссылку ещё раз.`,
          {
            parse_mode: "HTML",
            link_preview_options: { is_disabled: true },
            ...Markup.inlineKeyboard([[
              Markup.button.url("⭐ Подписаться", "https://t.me/Roblox_Bank_Tg")
            ]]),
          }
        );
        return;
      }
    }

    const passId = extractPassId(text);

    if (!passId) {
      const fc = getFailCounts(ctx.from.id);
      fc.formatError++;
      const formatHint =
        "⚠️ Не удалось распознать геймпасс.\n\n" +
        "Пришли одно из:\n" +
        "• Ссылку: <code>https://www.roblox.com/game-pass/1234567/...</code>\n" +
        "• Ссылку из конструктора: <code>https://create.roblox.com/...</code>\n" +
        "• Просто ID (только цифры): <code>1234567</code>";
      if (fc.formatError >= 2) {
        await ctx.reply(formatHint, { parse_mode: "HTML", ...withSupportKb(undefined, "pass_format") });
      } else {
        await ctx.reply(formatHint, { parse_mode: "HTML" });
      }
      return;
    }

    const expectedPrice = Math.ceil(state.denomination / 0.7);

    // ── Roblox API validation ─────────────────────────────────────────────
    // Show a "checking" message — validation can take 10–30 s via bridge/retries.
    await ctx.sendChatAction("typing");
    const checkingMsg = await ctx.reply("⏳ Проверяем геймпасс…");
    let validatedCreator: string | null = null;
    let validatedPrice: number | null = null;
    const gamepassInfo = await getGamepassDetails(passId);
    // Delete the placeholder before sending the actual result.
    try { await bot.telegram.deleteMessage(ctx.chat!.id, checkingMsg.message_id); } catch {}

    if (!gamepassInfo) {
      // Roblox returned HTTP responses but no usable data → gamepass doesn't exist.
      // "Тупик" — user can't fix this without external help, show support immediately.
      await ctx.reply(
        "❌ Геймпасс не найден на Roblox.\n\n" +
        "Убедись, что:\n" +
        "• Геймпасс <b>опубликован</b> (не в черновиках)\n" +
        "• Ссылка ведёт именно на Game Pass, а не на саму игру\n" +
        "• Ты скопировал ссылку прямо из браузера Roblox\n\n" +
        "Если геймпасс точно существует — мы поможем разобраться:",
        { parse_mode: "HTML", ...withSupportKb("💬 Написать нам", "pass_not_found") }
      );
      return;
    }

    if (!gamepassInfo.validationSkipped) {
      // Normal validation — only runs when Roblox API was reachable

      /** Notify admins about a validation rejection so they're aware. Non-fatal. */
      const notifyAdminValidationFail = async (reason: string) => {
        const tgDisplay = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || "Пользователь");
        const alertText =
          `⚠️ <b>НЕВЕРНЫЙ ГЕЙМПАСС</b>\n` +
          `👤 Юзер: <a href="tg://user?id=${ctx.from.id}">${tgDisplay}</a> (ID: ${ctx.from.id})\n` +
          `🔑 Код ВБ: <code>${state.wbCode}</code>\n` +
          `🔗 Pass ID: <code>${passId}</code>\n` +
          `❌ Причина: ${reason}`;
        for (const adminId of ADMIN_IDS) {
          try { await bot.telegram.sendMessage(adminId, alertText, { parse_mode: "HTML", link_preview_options: { is_disabled: true } }); } catch {}
        }
      };

      if (!gamepassInfo.isActive) {
        const fc = getFailCounts(ctx.from.id);
        fc.notActive++;
        if (gamepassInfo.isNotInCatalog) {
          if (fc.notActive === 1) await notifyAdminValidationFail("Геймпасс не найден в каталоге — скорее всего закрытая игра");
          await ctx.reply(
            `❌ <b>Геймпасс недоступен</b> — скорее всего, игра, в которой он создан, закрыта (Private).\n\n` +
            `Два варианта:\n` +
            `1. Открой игру: Creator Hub → Experience → Settings → Permissions → <b>Public</b> → сохрани. Затем пришли ссылку снова.\n` +
            `2. Создай геймпасс в любой <b>публичной</b> игре (цена: <b>${expectedPrice} R$</b>) и пришли новую ссылку.\n\n` +
            `Не удаляй геймпасс до получения оплаты.`,
            { parse_mode: "HTML", ...Markup.inlineKeyboard([
              [Markup.button.url("📖 Инструкция", `https://robloxbank.ru/guide?source=wb&skip=1&code=${state.wbCode}`)],
              [supportBtn("💬 Нужна помощь?", "pass_deleted")],
            ]) }
          );
        } else if (gamepassInfo.isGamePrivate) {
          if (fc.notActive === 1) await notifyAdminValidationFail("Игра закрыта (private) — геймпасс не продаётся");
          await ctx.reply(
            `❌ <b>Геймпасс в закрытой игре</b> — выкупить невозможно.\n\n` +
            `Как открыть игру:\n` +
            `1. Нажми на плейс → <b>Configure → Settings</b>\n` +
            `2. Найди раздел Audience → выбери <b>Public</b> → сохрани\n\n` +
            `Не помогло? <b>Configure → Questionnaire → Restart</b>\n` +
            `Ответь «No» на все 10 вопросов → Continue\n\n` +
            `Или создай геймпасс в другой публичной игре (цена: <b>${expectedPrice} R$</b>)`,
            { parse_mode: "HTML", ...Markup.inlineKeyboard([
              [Markup.button.url("📖 Полная инструкция", `https://robloxbank.ru/guide?source=wb&skip=1&code=${state.wbCode}`)],
              [supportBtn("💬 Нужна помощь?", "pass_private")],
            ]) }
          );
        } else {
          if (fc.notActive === 1) await notifyAdminValidationFail("Геймпасс не выставлен на продажу");
          const notActiveText =
            `⚠️ Геймпасс не выставлен на продажу.\n\n` +
            `Зайди в Creator Dashboard → Creations → Passes, найди геймпасс <b>${passId}</b>, ` +
            `нажми «Edit» и поставь галочку «On Sale». После этого пришли ссылку снова.`;
          await ctx.reply(notActiveText, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[
              Markup.button.url("📖 Инструкция", `https://robloxbank.ru/guide?source=wb&skip=1&code=${state.wbCode}`),
              ...(fc.notActive >= 2 ? [supportBtn("Нужна помощь?", "pass_inactive")] : []),
            ]]),
          });
        }
        return;
      }

      if (Math.abs(gamepassInfo.price - expectedPrice) > 2) {
        const fc = getFailCounts(ctx.from.id);
        fc.priceMismatch++;
        if (fc.priceMismatch === 1) await notifyAdminValidationFail(`Неверная цена: ${gamepassInfo.price} R$ (ожидалось ${expectedPrice} R$)`);
        const priceMismatchText =
          `⚠️ Цена геймпасса не совпадает с ожидаемой.\n\n` +
          `Установлено: <b>${gamepassInfo.price} R$</b>\n` +
          `Ожидается:   <b>${expectedPrice} R$</b>\n\n` +
          `Зайди в Creator Dashboard → Passes → Edit, измени цену и пришли ссылку снова.\n\n` +
          `💡 Если у тебя включён <b>Regional Pricing</b> — обязательно выключи его (Passes → Edit → Pricing → убрать галочку Enable Regional Pricing), иначе цена будет неверной.`;
        await ctx.reply(priceMismatchText, {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[
            Markup.button.url("📖 Инструкция", `https://robloxbank.ru/guide?source=wb&skip=1&code=${state.wbCode}`),
            ...(fc.priceMismatch >= 2 ? [supportBtn("Нужна помощь с ценой?", "pass_price")] : []),
          ]]),
        });
        return;
      }

      // Store creator/price for the merged confirmation message below
      validatedCreator = gamepassInfo.creatorName ?? null;
      validatedPrice = gamepassInfo.price;
    } else {
      // Network-down fallback — Roblox API unreachable, proceed without validation
      console.warn(
        `[TG] Roblox API unreachable — accepting passId=${passId} without validation. ` +
        `Admin must verify price manually.`
      );
      await ctx.reply(
        `⚠️ Не удалось автоматически проверить геймпасс — серверы Roblox временно недоступны.\n\n` +
        `Убедись, что цена геймпасса установлена ровно <b>${Math.ceil(state.denomination / 0.7)} R$</b>. ` +
        `Мы проверим вручную — просто жди уведомления.`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("📊 Проверить статус", CB.refreshStatus)],
            [supportBtn("💬 Вопросы по заявке?", "roblox_down")],
          ]),
        }
      );
      // Alert admins so they know manual price check is required
      const alertText =
        `⚠️ <b>РУЧНАЯ ПРОВЕРКА</b>\n` +
        `Roblox API недоступен — геймпасс принят без автоматической проверки цены.\n` +
        `Pass ID: <code>${passId}</code> · Ожидаемая цена: ${Math.ceil(state.denomination / 0.7)} R$`;
      for (const adminId of ADMIN_IDS) {
        try { await bot.telegram.sendMessage(adminId, alertText, { parse_mode: "HTML" }); } catch {}
      }
    }
    // ── End Roblox validation ─────────────────────────────────────────────

    const cleanLink = `https://www.roblox.com/game-pass/${passId}`;

    const user = await (db as any).user.findUnique({ where: { tgId: String(ctx.from.id) } });
    if (!user) {
      await ctx.reply(
        "Что-то пошло не так — напиши нам, разберёмся вместе:",
        {
          parse_mode: "HTML",
          ...withSupportKb("💬 Написать нам", "session_err"),
        }
      );
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
        // Direct orders have a synthetic DIR- code — no WbCode record exists, skip claim step.
        if (!state.wbCode.startsWith("DIR-")) {
        const claimed = await tx.wbCode.updateMany({
          where: {
            code: { equals: state.wbCode, mode: "insensitive" },
            OR: [
              { status: "RESERVED" },
              { userId: null },
              { status: "CLAIMED", isUsed: false, userId: user.id }, // provisional state
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
          // Code already assigned to this user — mark as used now
          await tx.wbCode.update({
            where: { id: existingCode.id },
            data: { isUsed: true, usedAt: new Date() },
          });
        }
        } // end: if (!state.wbCode.startsWith("DIR-"))

        // Check if an order already exists for this WB code.
        // Since wbCode is @unique, we can only have one record per code.
        const existingOrder = await tx.wbOrder.findUnique({
          where: { wbCode: state.wbCode }
        });

        let newOrder;
        if (existingOrder) {
          if (existingOrder.status === "AWAITING_GAMEPASS" || existingOrder.status === "REJECTED") {
            // Promote to PENDING with the gamepass link
            newOrder = await tx.wbOrder.update({
              where: { id: existingOrder.id },
              data: {
                gamepassUrl: cleanLink,
                status: "PENDING",
                rejectionReason: null,
                adminId: null,
              },
            });
          } else {
            // Already processing or completed
            throw Object.assign(new Error("Order already exists"), { code: "P2002" });
          }
        } else {
          // No provisional order — legitimate path for text-entry activations
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
          await tx.user.update({
            where: { id: user.id },
            data: { balance: 0, reviewBonusGrantedAt: null, reviewReminderLevel: 0 },
          });
        }

        return newOrder;
      });
    } catch (err: any) {
      if (err.isClaimed) {
        pendingLink.delete(ctx.from.id);
        clearFailCounts(ctx.from.id);
        // "Тупик" — user cannot resolve this themselves
        await ctx.reply(
          "⚠️ Этот код уже был активирован другим пользователем.\n\nЕсли уверен, что код твой — напиши нам:",
          { parse_mode: "HTML", ...withSupportKb() }
        );
        return;
      }
      if (err.code === "P2002") {
        pendingLink.delete(ctx.from.id);
        clearFailCounts(ctx.from.id);
        await ctx.reply(
          "⚠️ Заказ по этому коду уже создан и сейчас обрабатывается.",
          Markup.inlineKeyboard([
            [Markup.button.callback("📊 Проверить статус", CB.refreshStatus)],
            [supportBtn("💬 Если что-то не так", "order_dupe")],
          ])
        );
        return;
      }
      console.error("[TG] Order create error:", err);
      // "Тупик" — DB/infrastructure error, user helpless
      await ctx.reply(
        "❌ Ошибка при создании заявки. Попробуй ещё раз через минуту.\n\nЕсли ошибка повторяется:",
        { parse_mode: "HTML", ...withSupportKb() }
      );
      return;
    }

    pendingLink.delete(ctx.from.id);
    clearFailCounts(ctx.from.id); // success — reset progressive disclosure counters

    const creatorLine = validatedCreator ? `👤 Создатель: ${validatedCreator}\n` : "";
    const priceLine = validatedPrice != null ? `💰 Цена: ${validatedPrice} R$\n` : "";
    await ctx.reply(
      `🎉 Отлично, геймпасс принят!\n` +
      creatorLine +
      priceLine +
      `\n🆔 Номер заявки: <code>${order.id.slice(-6).toUpperCase()}</code>\n\n` +
      `⏳ Выкупим в течение нескольких часов — обычно быстрее. Как только будет готово — напишем.\n` +
      `💡 <i>Робуксы начислит Roblox — обычно в течение 5–7 дней после выкупа.</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[Markup.button.callback("📊 Проверить статус", CB.refreshStatus)]]),
      }
    );

    // Notify all Telegram admins (non-fatal — errors don't affect user)
    try {
      const fullOrder = await (db as any).wbOrder.findUnique({
        where: { id: order.id },
        include: { user: true }
      });
      if (fullOrder) {
        const { text: cardText, reply_markup } = await renderOrderCard(fullOrder, validatedCreator ?? undefined, gamepassInfo.isAgeRestricted);
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
async function renderOrderCard(order: any, creatorName?: string, isAgeRestricted?: boolean) {
  const shortId = order.id.slice(-6).toUpperCase();
  const passPrice = Math.ceil(order.amount / 0.7);
  const statusLabels: any = {
    AWAITING_GAMEPASS: "⌛ Ожидаем геймпасс",
    PENDING: "⏳ В обработке",
    IN_PROGRESS: "🔧 В работе",
    COMPLETED: "✅ Выполнен",
    REJECTED: "❌ Отклонён",
  };

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
  const reviewLine = wbCode?.reviewBonusClaimed ? `🌟 Отзыв: <b>Оставлен (+100 R$)</b>\n` : `🌟 Отзыв: <b>Нет</b>\n`;

  // Loyalty tag — subtract 1 to get count of orders BEFORE the current one
  const totalOrders = await (db as any).wbOrder.count({ where: { userId: order.userId } }).catch(() => 1);
  const prev = Math.max(0, totalOrders - 1);
  const loyaltyLine =
    prev >= 5 ? `👑 <b>VIP КЛИЕНТ (${prev} заказов)</b>\n` :
      prev >= 1 ? `🔄 <b>ПОВТОРНЫЙ КЛИЕНТ</b>\n` :
        "";

  const directTag = order.isDirectOrder ? `🔷 <b>ПРЯМОЙ ЗАКАЗ</b>\n` : ``;

  const gpCreatorLine    = creatorName      ? `🎮 Создатель ГП: <b>${creatorName}</b>\n`  : "";
  const ageRestrictLine  = isAgeRestricted  ? `🔞 <b>Игра 18+ — выкуп вручную</b>\n`      : "";

  const text =
    `📦 <b>ЗАКАЗ #${shortId}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    directTag +
    loyaltyLine +
    `${platformEmoji} Источник: <b>${order.platform}</b>\n` +
    (dateStr ? `📅 Время: <b>${dateStr}</b>\n` : "") +
    `👤 Юзер: ${userLabel}\n` +
    bonusLine +
    gpCreatorLine +
    ageRestrictLine +
    (order.isDirectOrder ? `` : reviewLine) +
    `💎 Сумма: <b>${order.amount} R$</b> (Геймпасс: ${passPrice} R$)\n` +
    (order.isDirectOrder ? `` : `🔑 Код ВБ: <code>${order.wbCode}</code>\n`) +
    `📊 Статус: <b>${statusLabels[order.status] || order.status}</b>${reasonLine}` +
    (order.gamepassUrl ? `\n\n🔗 <a href="${order.gamepassUrl}">Открыть Gamepass</a>` : ``);

  // Action buttons for PENDING and IN_PROGRESS orders
  const reply_markup = (order.status === "PENDING" || order.status === "IN_PROGRESS") ? {
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

  if (lowerQ.length < 4) {
    return ctx.reply("🔎 Введи не менее 4 символов для поиска.");
  }

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
// WB code direct text entry — user typed the code manually (e.g. after getting
// stuck due to a prior error or losing the deep link)
// ─────────────────────────────────────────────────────────────────────────────

async function handleWbCodeTextEntry(bot: Telegraf, ctx: any, tgId: string, text: string): Promise<void> {
  const codeInput = text.toUpperCase();

  const wbCode = await (db as any).wbCode.findFirst({
    where: { code: { equals: codeInput, mode: "insensitive" } },
  });

  if (!wbCode) {
    await ctx.reply(
      `❌ Код <b>${codeInput}</b> не найден.\n\n` +
      `Проверь правильность ввода или обратись в поддержку:`,
      { parse_mode: "HTML", ...withSupportKb() }
    );
    return;
  }

  // Same guard as registerStart — only block when the code was truly completed
  // (isUsed=true + userId set). CLAIMED+isUsed=false is a provisional state
  // (bot claimed it but gamepass not sent yet), which should still be allowed through.
  if (wbCode.isUsed && wbCode.userId) {
    await ctx.reply("⚠️ Этот код уже был активирован ранее.", { parse_mode: "HTML", ...withSupportKb("💬 Это не мой заказ?", "code_mine") });
    return;
  }

  // Valid code — find or create user and set session
  let user = await (db as any).user.findUnique({ where: { tgId } });
  if (!user) {
    user = await (db as any).user.create({
      data: {
        tgId,
        name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || null,
      },
    });
  }

  // If code is CLAIMED by a different user, block
  if (wbCode.status === "CLAIMED" && wbCode.userId && wbCode.userId !== user.id) {
    await ctx.reply("⚠️ Этот код уже был активирован другим пользователем.", { parse_mode: "HTML", ...withSupportKb("💬 Оспорить — написать нам", "code_claimed") });
    return;
  }

  const totalAmount = wbCode.denomination + (user.balance || 0);
  const passPrice = Math.ceil(totalAmount / 0.7);

  pendingLink.set(ctx.from.id, { wbCode: wbCode.code, denomination: totalAmount });
  clearFailCounts(ctx.from.id);

  // ── Provisional order: claim code + notify admins BEFORE subscription gate ──
  // Mirrors registerStart — user identity is captured even if they bail at the sub step.
  let provisionalCreated = false;
  try {
    await (db as any).$transaction(async (tx: any) => {
      const existingOrder = await tx.wbOrder.findUnique({ where: { wbCode: wbCode.code } });
      if (existingOrder) return;
      await tx.wbCode.update({
        where: { code: wbCode.code },
        data: { userId: user.id, status: "CLAIMED", isUsed: false },
      });
      await tx.wbOrder.create({
        data: {
          amount: totalAmount,
          gamepassUrl: null,
          status: "AWAITING_GAMEPASS",
          platform: "TG",
          userId: user.id,
          wbCode: wbCode.code,
        },
      });
      provisionalCreated = true;
    });
  } catch (err) {
    console.error("[TG] Text-entry provisional order creation failed:", err);
  }

  if (provisionalCreated) {
    try {
      const tgDisplay = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || "Пользователь");
      const dateStr = new Date().toLocaleString("ru-RU", {
        timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit",
        year: "numeric", hour: "2-digit", minute: "2-digit",
      }) + " МСК";
      const notifyText =
        `📥 <b>НОВЫЙ КЛИЕНТ</b>\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `📅 Время: <b>${dateStr}</b>\n` +
        `👤 Юзер: <a href="tg://user?id=${ctx.from.id}">${tgDisplay}</a> (ID: ${ctx.from.id})\n` +
        `💎 Сумма: <b>${totalAmount} R$</b> (Геймпасс: ${passPrice} R$)\n` +
        `🔑 Код ВБ: <code>${codeInput}</code>\n` +
        `📊 Статус: ⌛ Ожидаем ссылку на геймпасс`;

      const chatIds = [
        ...ADMIN_IDS,
        ...((process.env.TG_CHAT_ID ?? "").split(",").map((s) => s.trim()).filter((s) => s && !ADMIN_IDS.includes(s))),
      ];
      await Promise.allSettled(
        chatIds.map((id) => tgSend(id, notifyText))
      );
    } catch (err) {
      console.error("[TG] Text-entry admin notify error:", err);
    }
  }

  // ── Subscription gate (order already created above) ───────────────────────
  const subscribed = await checkSubscription(bot, ctx.from.id);
  if (!subscribed) {
    await ctx.reply(
      `🎉 Код <b>${codeInput}</b> принят!\n\n` +
      `Ты в одном шаге — у наших клиентов есть закрытый канал: там первыми узнают о выкупе, ` +
      `получают бонусы на следующий заказ и эксклюзивные акции.\n\n` +
      `👇 Загляни — это бесплатно:\n` +
      `https://t.me/Roblox_Bank_Tg\n\n` +
      `После подписки бот напишет тебе автоматически — ничего дополнительно делать не нужно.\n` +
      `Если сообщение не пришло — просто напиши сюда любое слово 👋`,
      {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...Markup.inlineKeyboard([[Markup.button.url("⭐ Стать участником", "https://t.me/Roblox_Bank_Tg")]]),
      }
    );
    return;
  }

  let bonusText = "";
  if (user.balance && user.balance > 0) {
    bonusText = `🎁 Использован бонус: <b>${user.balance} R$</b>\n💎 Итого к выдаче: <b>${totalAmount} R$</b>\n\n`;
  } else {
    bonusText = `💎 Номинал: <b>${wbCode.denomination} R$</b>\n\n`;
  }

  await ctx.reply(
    `✅ Код <b>${codeInput}</b> активирован!\n` +
    bonusText +
    `Теперь создай геймпасс в Roblox и пришли на него ссылку сюда.\n` +
    `📌 Цена геймпасса должна быть ровно <b>${passPrice} R$</b>\n` +
    `<i>(это номинал ÷ 0.7 — Roblox удерживает 30% комиссии)</i>\n\n` +
    `❓ Что такое геймпасс и как его создать — в инструкции:\n` +
    `👉 https://www.robloxbank.ru/guide?source=wb&skip=1&code=${codeInput}\n\n` +
    `Пришли ссылку на геймпасс прямо сюда 👇`,
    {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...Markup.inlineKeyboard([
        [Markup.button.url("📖 Открыть инструкцию", `https://www.robloxbank.ru/guide?source=wb&skip=1&code=${codeInput}`)],
        [supportBtn("💬 Нужна помощь?")],
      ]),
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Photo messages — collect review screenshots
// ─────────────────────────────────────────────────────────────────────────────

export function registerPhoto(bot: Telegraf): void {
  bot.on("photo", async (ctx) => {
    const tgId = String(ctx.from.id);
    const user = await (db as any).user.findUnique({ where: { tgId } });
    if (!user) return;

    // 0a. Payment screenshot for direct orders — in-memory path (takes priority)
    const paymentOrderId = pendingPaymentScreenshot.get(ctx.from.id);
    if (paymentOrderId) {
      pendingPaymentScreenshot.delete(ctx.from.id);
      const fileId = ctx.message.photo.at(-1)!.file_id;
      const payOrder = await (db as any).wbOrder.findUnique({ where: { id: paymentOrderId }, select: { amount: true } });
      await ctx.reply("✅ Скриншот получен! Менеджер проверит — обычно до 15 минут.");
      await sendAdminPaymentCard({
        orderId: paymentOrderId,
        userId: user.id as string,
        photoFileId: fileId,
        userDisplay: userDisplay(ctx.from),
        amount: payOrder?.amount,
      });
      return;
    }

    // 0b. DB recovery: bot restarted while user was in PAYMENT_PENDING state
    {
      const pendingPayOrder = await (db as any).wbOrder.findFirst({
        where: { userId: user.id, status: "PAYMENT_PENDING" },
        orderBy: { createdAt: "desc" },
      });
      if (pendingPayOrder) {
        const fileId = ctx.message.photo.at(-1)!.file_id;
        await ctx.reply("✅ Скриншот получен! Менеджер проверит — обычно до 15 минут.");
        await sendAdminPaymentCard({
          orderId: pendingPayOrder.id,
          userId: user.id as string,
          photoFileId: fileId,
          userDisplay: userDisplay(ctx.from),
          amount: pendingPayOrder.amount,
        });
        return;
      }
    }

    // 1. Check in-memory state first (fastest path)
    let orderId = pendingReview.get(ctx.from.id);

    // 2. DB fallback: latest COMPLETED WB order whose review bonus is not yet claimed
    if (!orderId) {
      const order = await (db as any).wbOrder.findFirst({
        where: { userId: user.id, status: "COMPLETED", isDirectOrder: false },
        orderBy: { updatedAt: "desc" },
      });
      const linked = order
        ? await (db as any).wbCode.findFirst({
          where: { userId: user.id, reviewBonusClaimed: false },
        })
        : null;

      if (!order || !linked) {
        await ctx.reply(
          "У тебя пока нет выполненных заказов, за которые можно получить бонус.\n\n" +
          "Когда заказ будет выполнен, пришли скриншот отзыва с Wildberries — начислим +100 R$!",
          withSupportKb()
        );
        return;
      }
      orderId = order.id as string;
    }

    pendingReview.delete(ctx.from.id);

    // Telegram file_id of the largest photo size
    const fileId = ctx.message.photo.at(-1)!.file_id;

    await ctx.reply(
      "✅ Скриншот получен! Ожидай решения администратора — обычно это занимает до 30 минут."
    );

    try {
      await sendAdminReviewCard({
        orderId,
        userId:      user.id as string,
        photoSource: fileId,
        userDisplay: userDisplay(ctx.from),
      });
    } catch (err) {
      console.error("[TG] sendAdminReviewCard failed:", err);
      // Fallback: send plain alert + photo directly to each admin
      for (const adminId of ADMIN_IDS) {
        try {
          await bot.telegram.sendMessage(adminId,
            `⚠️ <b>Ошибка доставки карточки отзыва — требуется ручная проверка</b>\n\n` +
            `👤 Юзер: ${userDisplay(ctx.from)}\n` +
            `📦 Заказ: <code>${orderId}</code>`,
            { parse_mode: "HTML" }
          );
          await bot.telegram.sendPhoto(adminId, fileId);
        } catch {}
      }
    }
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
    const tgId = String(ctx.from.id);
    const adminId = tgId;
    const adminTag = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name ?? "Админ";

    // ── 🆘 sup: — user tapped a support button ────────────────────────────
    if (data.startsWith("sup:")) {
      const ctxKey = data.slice(4);
      const userDisplay = ctx.from.username
        ? `@${ctx.from.username}`
        : ctx.from.first_name ?? `tg:${tgId}`;

      const pendingState = pendingLink.get(ctx.from.id);
      let wbCode    = pendingState?.wbCode;
      let denom     = pendingState?.denomination;

      if (!wbCode) {
        try {
          const u = await (db as any).user.findUnique({ where: { tgId }, select: { id: true } });
          if (u) {
            const o = await (db as any).wbOrder.findFirst({
              where: { userId: u.id },
              orderBy: { updatedAt: "desc" },
              select: { wbCode: true, amount: true },
            });
            if (o) { wbCode = o.wbCode; denom = o.amount; }
          }
        } catch {}
      }

      await sendAdminSupportAlert({
        platform: "TG", userDisplay, tgId, contextKey: ctxKey,
        wbCode, denomination: denom,
      });
      await ctx.answerCbQuery("Менеджер уже в курсе 👍");
      await ctx.reply(
        "Соединяем с менеджером — напиши @RobloxBank_PA\n\nМы уже знаем о твоей ситуации 👍",
        { parse_mode: "HTML" }
      );
      return;
    }

    // ── Route to admin hub handlers first ─────────────────────────────────
    const hubHandled = await routeAdminCallback(bot, ctx, data, adminId);
    if (hubHandled) return;

    // ── ✅ admin_ok: order completed ──────────────────────────────────────
    if (data.startsWith("admin_ok:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const orderId = data.split(":")[1];
      try {
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
        if (!order) {
          await ctx.answerCbQuery("⚠️ Заказ не найден");
          return;
        }
        const user = order.userId
          ? await (db as any).user.findUnique({ where: { id: order.userId } })
          : null;

        const editedText = `✅ <b>Выполнено админом ${adminTag}</b>\nЗаказ #${orderId.slice(-6).toUpperCase()} · ${order.amount} R$`;
        try { await ctx.editMessageText(editedText, { parse_mode: "HTML" }); } catch { }

        if (user) await notifyUserCompleted(bot, user, orderId, order.amount, order.isDirectOrder ?? false);
        await updateMainMenu(bot);
        await ctx.answerCbQuery("✅ Выполнено");
      } catch (err) {
        console.error("[admin_ok] error:", err);
        await ctx.answerCbQuery("❌ Ошибка, попробуйте ещё раз").catch(() => {});
      }
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

    // ── ✅ confirm_reject: confirmed → show preset reason buttons ───────────
    if (data.startsWith("confirm_reject:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const orderId = data.split(":")[1];
      try { await ctx.editMessageText(
        `📋 Выбери причину отклонения заказа <code>${orderId.slice(-6).toUpperCase()}</code>:`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🔕 Не на продаже",    CB.orderRejectReason(orderId, "notsale"))],
            [Markup.button.callback("💰 Неверная цена",    CB.orderRejectReason(orderId, "price"))],
            [Markup.button.callback("🔗 Ссылка не та",     CB.orderRejectReason(orderId, "badlink"))],
            [Markup.button.callback("🔒 Закрытая игра",    CB.orderRejectReason(orderId, "privgame"))],
            [Markup.button.callback("✏️ Написать причину", CB.orderRejectCustom(orderId))],
            [Markup.button.callback("🚫 Без причины",      `admin_reject_none:${orderId}`)],
          ])
        }
      ); } catch { }
      await ctx.answerCbQuery();
      return;
    }

    // ── 📋 ord_rr: preset order rejection reason ─────────────────────────────
    if (data.startsWith("ord_rr:") && !data.startsWith("ord_rr_txt:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const parts = data.split(":");
      const orderId = parts[1];
      const key     = parts[2];
      const reasonMap: Record<string, string> = {
        notsale:  "Геймпасс не выставлен на продажу",
        price:    "Неверная цена геймпасса",
        badlink:  "Неверная ссылка на геймпасс",
        privgame: "Игра закрытая (private) — нужно сделать публичной. Подробная инструкция ниже.",
      };
      const reason = reasonMap[key] ?? key;
      pendingRejectionReason.delete(ctx.from.id);
      try {
        await performAdminReject(bot, ctx, orderId, reason);
      } finally {
        await ctx.answerCbQuery("✅ Заказ отклонён");
      }
      return;
    }

    // ── ✏️ ord_rr_txt: admin wants to type a custom reason ──────────────────
    if (data.startsWith("ord_rr_txt:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const orderId = data.split(":")[1];
      pendingRejectionReason.set(ctx.from.id, orderId);
      try { await ctx.editMessageText(
        `✏️ Напиши причину отклонения заказа <code>${orderId.slice(-6).toUpperCase()}</code>:`,
        { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("❌ Отмена", `cancel_reject:${orderId}`)]]) }
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

    // ── 💎 DIRECT ORDER callbacks ─────────────────────────────────────────────

    // start_direct: user opens direct order flow — show predefined packs
    if (data === CB.startDirect) {
      const dirUser = await (db as any).user.findUnique({
        where: { tgId },
        select: { balance: true },
      });
      const bonus = dirUser?.balance ?? 0;
      const bonusNote = bonus > 0
        ? `\n\n🎁 У тебя есть бонус <b>${bonus} R$</b> — автоматически добавится к заказу.`
        : "";
      pendingDirectAmount.set(ctx.from.id, true);
      await ctx.reply(
        `💎 <b>Прямой заказ Robux</b>\n\nВыбери количество (курс <b>0.7 ₽/R$</b>):` + bonusNote,
        { parse_mode: "HTML", ...buildPackKb() }
      );
      await ctx.answerCbQuery();
      return;
    }

    // dp: user selects a predefined pack
    if (data.startsWith("dp:")) {
      const amt = parseInt(data.slice(3), 10);
      if (isNaN(amt) || !(DIRECT_PACKS as readonly number[]).includes(amt)) {
        await ctx.answerCbQuery("Неверный пак");
        return;
      }
      pendingDirectAmount.delete(ctx.from.id);
      const dirUser = await (db as any).user.findUnique({
        where: { tgId },
        select: { balance: true },
      });
      const bonus = dirUser?.balance ?? 0;
      const totalAmount = amt + bonus;
      const passPrice = Math.ceil(totalAmount / 0.7);
      const rublePrice = Math.round(amt * DIRECT_RATE);
      pendingDirectOrder.set(ctx.from.id, { amount: amt, passPrice, totalAmount });
      const bonusSection = bonus > 0
        ? `💎 Запрос:          ${amt} R$\n` +
          `🎁 Твой бонус:     +${bonus} R$\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `📦 Итого получишь:  ${totalAmount} R$\n`
        : `📦 Получишь:       ${totalAmount} R$\n`;
      try {
        await ctx.editMessageText(
          `✅ <b>Подтверди заказ</b>\n\n` +
          bonusSection +
          `💰 К оплате:       ${fmtRub(rublePrice)}\n` +
          `📌 Цена геймпасса:  ${passPrice} R$`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[
              Markup.button.callback("✅ Подтвердить", CB.confirmDirect),
              Markup.button.callback("❌ Отмена", CB.cancelDirect),
            ]]),
          }
        );
      } catch {
        await ctx.reply(
          `✅ <b>Подтверди заказ</b>\n\n` +
          bonusSection +
          `💰 К оплате:       ${fmtRub(rublePrice)}\n` +
          `📌 Цена геймпасса:  ${passPrice} R$`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[
              Markup.button.callback("✅ Подтвердить", CB.confirmDirect),
              Markup.button.callback("❌ Отмена", CB.cancelDirect),
            ]]),
          }
        );
      }
      await ctx.answerCbQuery();
      return;
    }

    // confirm_direct: user confirms amount on confirmation screen
    if (data === CB.confirmDirect) {
      const dirState = pendingDirectOrder.get(ctx.from.id);
      if (!dirState) {
        await ctx.answerCbQuery("Начни заново");
        try {
          await ctx.editMessageText(
            "⏳ <b>Время подтверждения вышло.</b>\n\nНажми кнопку — начнём заново, сумма не сохраняется.",
            { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("💎 Заказать напрямую", CB.startDirect)]]) }
          );
        } catch { }
        return;
      }
      pendingDirectOrder.delete(ctx.from.id);
      let dirUser = await (db as any).user.findUnique({ where: { tgId } });
      if (!dirUser) {
        dirUser = await (db as any).user.create({
          data: {
            tgId,
            name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || null,
          },
        });
      }

      // Guard: one active direct order at a time
      const existingDirect = await (db as any).wbOrder.findFirst({
        where: { userId: dirUser.id, status: { in: ["AWAITING_PAYMENT", "PAYMENT_PENDING"] } },
      });
      if (existingDirect) {
        pendingDirectOrder.delete(ctx.from.id);
        await ctx.answerCbQuery("У тебя уже есть активный заказ");
        try {
          await ctx.editMessageText(
            `⏳ У тебя уже есть активный заказ <b>#${existingDirect.id.slice(-6).toUpperCase()}</b>.\n\n` +
            `Дождись реквизитов от менеджера, а затем оформи новый.`,
            { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("📊 Статус заказа", CB.refreshStatus)]]) }
          );
        } catch { }
        return;
      }

      const dirCode = generateDirectCode();
      let newDirectOrder: any;
      const bonus = dirState.totalAmount - dirState.amount;
      try {
        // Create order and atomically spend the bonus balance
        newDirectOrder = await (db as any).$transaction(async (tx: any) => {
          const ord = await tx.wbOrder.create({
            data: {
              amount:       dirState.totalAmount,
              gamepassUrl:  null,
              status:       "AWAITING_PAYMENT",
              platform:     "TG",
              userId:       dirUser.id,
              wbCode:       dirCode,
              isDirectOrder: true,
            },
          });
          if (bonus > 0) {
            await tx.user.update({
              where: { id: dirUser.id },
              data:  { balance: 0, reviewBonusGrantedAt: null, reviewReminderLevel: 0 },
            });
          }
          return ord;
        });
      } catch (err) {
        console.error("[TG] Direct order create error:", err);
        await ctx.answerCbQuery("Ошибка — попробуй снова");
        await ctx.reply("❌ Не удалось создать заказ. Попробуй снова.", { parse_mode: "HTML", ...withSupportKb() });
        return;
      }
      const shortId = newDirectOrder.id.slice(-6).toUpperCase();
      const tgDisplay = ctx.from.username ? `@${ctx.from.username}` : (ctx.from.first_name || "Пользователь");
      const prevOrdersCount = await (db as any).wbOrder.count({
        where: { userId: dirUser.id, status: "COMPLETED" },
      });
      await sendAdminDirectOrderCard({
        orderId:             newDirectOrder.id,
        userId:              dirUser.id,
        amount:              dirState.totalAmount,
        bonusApplied:        bonus,
        userDisplay:         `${tgDisplay} (ID: ${ctx.from.id})`,
        tgId,
        createdAt:           newDirectOrder.createdAt,
        previousOrdersCount: prevOrdersCount,
      });
      const confirmKb = Markup.inlineKeyboard([
        [Markup.button.callback("📊 Проверить статус", CB.refreshStatus)],
        [supportBtn("💬 Нужна помощь?", "direct_wait")],
      ]);
      try {
        await ctx.editMessageText(
          `📋 <b>Заказ #${shortId} оформлен!</b>\n\n` +
          `Менеджер пришлёт реквизиты для оплаты в течение нескольких минут.\n\n` +
          `Ожидай сообщения 👇`,
          { parse_mode: "HTML", ...confirmKb }
        );
      } catch {
        await ctx.reply(
          `📋 <b>Заказ #${shortId} оформлен!</b>\n\nМенеджер пришлёт реквизиты — ожидай.`,
          { parse_mode: "HTML", ...confirmKb }
        );
      }
      await ctx.answerCbQuery("✅ Заказ создан!");
      return;
    }

    // cancel_direct: user cancelled order confirmation
    if (data === CB.cancelDirect) {
      pendingDirectOrder.delete(ctx.from.id);
      pendingDirectAmount.delete(ctx.from.id);
      try { await ctx.editMessageText("Отменено.", { parse_mode: "HTML" }); } catch { }
      await ctx.answerCbQuery("Отменено");
      return;
    }

    // spd: admin sends payment details to user
    if (data.startsWith("spd:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const spdOrderId = data.slice(4);
      const spdOrder = await (db as any).wbOrder.findUnique({ where: { id: spdOrderId } });
      if (!spdOrder) { await ctx.answerCbQuery("Заказ не найден"); return; }
      if (spdOrder.status !== "AWAITING_PAYMENT") {
        await ctx.answerCbQuery("Реквизиты уже отправлены");
        return;
      }
      pendingPaymentDetails.set(ctx.from.id, spdOrderId);
      await ctx.reply(
        `💳 <b>Введи реквизиты для пользователя</b>\n` +
        `Заказ #${spdOrderId.slice(-6).toUpperCase()}\n\n` +
        `Просто напиши — я отправлю напрямую покупателю:`,
        { parse_mode: "HTML" }
      );
      await ctx.answerCbQuery();
      return;
    }

    // cdo: admin cancels direct order
    if (data.startsWith("cdo:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const cdoOrderId = data.slice(4);
      const cdoOrder = await (db as any).wbOrder.findUnique({ where: { id: cdoOrderId } });
      if (!cdoOrder) { await ctx.answerCbQuery("Заказ не найден"); return; }
      if (!["AWAITING_PAYMENT", "PAYMENT_PENDING"].includes(cdoOrder.status)) {
        await ctx.answerCbQuery("Заказ уже обрабатывается или завершён");
        return;
      }
      await (db as any).wbOrder.update({
        where: { id: cdoOrderId },
        data: { status: "REJECTED", rejectionReason: "Отменён менеджером" },
      });
      const cdoUser = await (db as any).user.findUnique({ where: { id: cdoOrder.userId } });
      if (cdoUser?.tgId) {
        try {
          await bot.telegram.sendMessage(
            cdoUser.tgId,
            `❌ <b>Заказ #${cdoOrderId.slice(-6).toUpperCase()} отменён.</b>\n\nЕсли хочешь — создай новый заказ.`,
            { parse_mode: "HTML", ...Markup.inlineKeyboard([
              [Markup.button.callback("💎 Новый заказ", CB.startDirect)],
              [supportBtn("💬 Это ошибка?", "order_cancelled")],
            ]) }
          );
        } catch { }
      } else if (cdoUser?.vkId) {
        try {
          await vkSend(cdoUser.vkId,
            `❌ Заказ #${cdoOrderId.slice(-6).toUpperCase()} отменён.\n\nЕсли хочешь — создай новый заказ напрямую (нажми кнопку "💎 Купить напрямую").\n\nЕсли считаешь, что это ошибка — https://t.me/RobloxBank_PA`
          );
        } catch { }
      }
      try { await ctx.editMessageText(
        (ctx.callbackQuery.message && "text" in ctx.callbackQuery.message ? ctx.callbackQuery.message.text : "") +
        `\n\n❌ Отменён — ${adminTag}`,
        { parse_mode: "HTML" }
      ); } catch { }
      await ctx.answerCbQuery("Заказ отменён");
      return;
    }

    // pay_ok: admin confirms payment screenshot
    if (data.startsWith("pay_ok:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const [, payOkOrderId, payOkUserId] = data.split(":");
      const payOkOrder = await (db as any).wbOrder.findUnique({ where: { id: payOkOrderId } });
      if (!payOkOrder) { await ctx.answerCbQuery("Заказ не найден"); return; }
      if (payOkOrder.status !== "PAYMENT_PENDING") {
        await ctx.answerCbQuery("Оплата уже обработана");
        return;
      }
      await (db as any).wbOrder.update({
        where: { id: payOkOrderId },
        data: { status: "AWAITING_GAMEPASS" },
      });
      const payOkUser = await (db as any).user.findUnique({ where: { id: payOkUserId } });
      if (payOkUser?.tgId) {
        const passPrice = Math.ceil(payOkOrder.amount / 0.7);
        pendingLink.set(parseInt(payOkUser.tgId), { wbCode: payOkOrder.wbCode, denomination: payOkOrder.amount });
        try {
          await bot.telegram.sendMessage(
            payOkUser.tgId,
            `✅ <b>Оплата подтверждена!</b>\n\n` +
            `Теперь создай геймпасс по инструкции:\n` +
            `📌 Цена геймпасса: <b>${passPrice} R$</b>\n\n` +
            `Когда создашь — пришли ссылку или ID сюда 👇`,
            {
              parse_mode: "HTML",
              link_preview_options: { is_disabled: true },
              ...Markup.inlineKeyboard([
                [Markup.button.url("📖 Инструкция", "https://robloxbank.ru/guide?source=direct")],
                [supportBtn("💬 Нужна помощь?")],
              ]),
            }
          );
        } catch { }
      } else if (payOkUser?.vkId) {
        const passPrice = Math.ceil(payOkOrder.amount / 0.7);
        try {
          await vkSend(payOkUser.vkId,
            `✅ Оплата подтверждена!\n\n` +
            `Теперь создай геймпасс по инструкции:\n` +
            `📌 Цена геймпасса: ${passPrice} R$\n\n` +
            `Когда создашь — пришли ссылку или ID прямо сюда 👇\n\n` +
            `Инструкция: https://robloxbank.ru/guide?source=direct`
          );
        } catch { }
      }
      const payOkCaption = `✅ Оплата принята — ${adminTag}\nЗаказ #${payOkOrderId.slice(-6).toUpperCase()}`;
      try { await ctx.editMessageCaption(payOkCaption, { parse_mode: "HTML" }); } catch { }
      await ctx.answerCbQuery("✅ Оплата подтверждена");
      return;
    }

    // pay_no: admin rejects payment screenshot
    if (data.startsWith("pay_no:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const [, payNoOrderId, payNoUserId] = data.split(":");
      const payNoOrder = await (db as any).wbOrder.findUnique({ where: { id: payNoOrderId }, select: { paymentDetails: true } });
      const payNoUser = await (db as any).user.findUnique({ where: { id: payNoUserId } });
      if (payNoUser?.tgId) {
        pendingPaymentScreenshot.set(parseInt(payNoUser.tgId), payNoOrderId);
        const detailsLine = payNoOrder?.paymentDetails
          ? `\n\n💳 Реквизиты:\n<code>${payNoOrder.paymentDetails}</code>\n`
          : "";
        try {
          await bot.telegram.sendMessage(
            payNoUser.tgId,
            `❌ <b>Не смогли подтвердить оплату.</b>` +
            detailsLine +
            `\nПришли скриншот ещё раз (фотографией, не файлом) 👇`,
            { parse_mode: "HTML", ...withSupportKb("💬 Нужна помощь?", "payment") }
          );
        } catch { }
      } else if (payNoUser?.vkId) {
        const detailsLine = payNoOrder?.paymentDetails
          ? `\n\n💳 Реквизиты:\n${payNoOrder.paymentDetails}\n`
          : "";
        try {
          await vkSend(payNoUser.vkId,
            `❌ Не смогли подтвердить оплату.` +
            detailsLine +
            `\nПришли скриншот ещё раз (фотографией, не файлом) 👇\n\nНужна помощь? https://t.me/RobloxBank_PA`
          );
        } catch { }
      }
      try { await ctx.editMessageCaption(`❌ Оплата отклонена — ${adminTag}`, { parse_mode: "HTML" }); } catch { }
      await ctx.answerCbQuery("Отклонено");
      return;
    }

    // ── ❌ admin_reject_none: reject without reason ─────────────────────────
    if (data.startsWith("admin_reject_none:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const orderId = data.split(":")[1];
      pendingRejectionReason.delete(ctx.from.id);
      await performAdminReject(bot, ctx, orderId, "");
      await ctx.answerCbQuery("Отклонено без причины");
      return;
    }

    // ── 🔄 user_resubmit: user wants to fix link ─────────────────────────────
    if (data.startsWith("user_resubmit:")) {
      const parts = data.split(":");
      const code = parts[1];

      // DIR- codes are synthetic — they can't have a gamepass link resubmitted
      if (code?.startsWith("DIR-")) {
        await ctx.answerCbQuery("Прямой заказ нельзя переоформить так");
        await ctx.reply(
          "Для нового прямого заказа используй кнопку ниже.",
          { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("💎 Заказать напрямую", CB.startDirect)]]) }
        );
        return;
      }

      const existingOrder = await (db as any).wbOrder.findFirst({
        where: { wbCode: code },
        orderBy: { createdAt: "desc" },
      });
      if (!existingOrder) {
        await ctx.reply("Заказ не найден — возможно, он уже завершён.", { parse_mode: "HTML", ...withSupportKb("💬 Разобраться с заявкой") });
        await ctx.answerCbQuery("Заказ не найден");
        return;
      }

      // Verify the order belongs to the calling user
      const callerUser = await (db as any).user.findUnique({ where: { tgId: String(ctx.from.id) } });
      if (!callerUser || existingOrder.userId !== callerUser.id) {
        await ctx.reply("⛔ Этот заказ не принадлежит твоему аккаунту.\n\nЕсли уверен, что это твой заказ:", { parse_mode: "HTML", ...withSupportKb() });
        await ctx.answerCbQuery("⛔ Нет доступа");
        return;
      }

      // Don't allow resubmit on already-processing or completed orders
      if (existingOrder.status === "IN_PROGRESS" || existingOrder.status === "COMPLETED" || existingOrder.status === "PENDING") {
        await ctx.reply("✅ Твой заказ уже принят в работу — исправлять ссылку не нужно.\n\nОжидай уведомления.", {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("📊 Проверить статус", CB.refreshStatus)]]),
        });
        await ctx.answerCbQuery("Заказ уже в работе — исправлять ссылку не нужно.");
        return;
      }

      const denomination = existingOrder.amount;

      pendingLink.set(ctx.from.id, { wbCode: code, denomination });
      const passPrice = Math.ceil(denomination / 0.7);

      await ctx.reply(
        `🔄 <b>Исправление ссылки</b>\n\n` +
        `💎 Номинал: <b>${denomination} R$</b>\n` +
        `Пришли ссылку на геймпасс с ценой ${passPrice} R$ 👇\n\n` +
        `💡 <i>Пример: https://www.roblox.com/game-pass/1234567/...</i>`,
        { parse_mode: "HTML", ...withSupportKb("💬 Нужна помощь?", "resubmit") }
      );
      await ctx.answerCbQuery();
      return;
    }

    // ── 🎁 review_ok: approve review bonus ───────────────────────────────
    if (data.startsWith("review_ok:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      const [, orderId, userId] = data.split(":");

      // Resolve which specific WB code to mark — prevents marking ALL codes for this user.
      const reviewOrder = await (db as any).wbOrder.findUnique({ where: { id: orderId } });
      if (!reviewOrder) {
        await ctx.answerCbQuery("Заказ не найден");
        return;
      }

      // Atomic idempotency guard: mark this specific code + increment balance in one transaction.
      // Direct orders (DIR- prefix) have no WbCode row — use user.reviewBonusGrantedAt as guard instead.
      const isDirectOrder = (reviewOrder.wbCode as string).startsWith("DIR-");
      let paid = false;
      await (db as any).$transaction(async (tx: any) => {
        if (isDirectOrder) {
          // Idempotency for direct orders: check reviewBonusGrantedAt hasn't been set yet.
          const u = await tx.user.findUnique({ where: { id: userId }, select: { reviewBonusGrantedAt: true } });
          if (u?.reviewBonusGrantedAt) return; // already paid
        } else {
          const result = await tx.wbCode.updateMany({
            where: { code: reviewOrder.wbCode, reviewBonusClaimed: false },
            data: { reviewBonusClaimed: true },
          });
          if (result.count === 0) return; // already paid
        }
        await tx.user.update({
          where: { id: userId },
          data: { balance: { increment: 100 }, reviewBonusGrantedAt: new Date(), reviewReminderLevel: 0 },
        });
        paid = true;
      });

      if (!paid) {
        await ctx.answerCbQuery("✅ Бонус уже начислен ранее");
        return;
      }

      const user = await (db as any).user.findUnique({ where: { id: userId } });
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30);
      const expiryStr = expiryDate.toLocaleDateString("ru-RU", {
        day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow",
      });
      const bonusMsg =
        `🎁 <b>+100 R$ зачислено на счёт!</b>\n\n` +
        `Действуют до ${expiryStr}.\n\n` +
        `Используй на прямой заказ — без карточки WB.\n` +
        `Бонус добавится к покупке автоматически.`;

      if (user?.tgId) {
        try {
          await bot.telegram.sendMessage(user.tgId, bonusMsg, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("💰 Купить напрямую", CB.startDirect)],
            ]),
          });
        } catch { }
      } else if (user?.vkId) {
        await vkSend(user.vkId, stripHtml(bonusMsg));
      }

      const caption = `🎁 Бонус начислен — ${adminTag}\nЗаказ #${orderId.slice(-6).toUpperCase()}`;
      try { await ctx.editMessageCaption(caption, { parse_mode: "HTML" }); } catch { }
      await ctx.answerCbQuery("+100 R$ начислено");
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

    // ── ✅ crn: confirmed → show preset reasons ──────────────────────────
    if (data.startsWith("crn:")) {
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

    // ── ❌ xrn: admin cancelled review rejection ─────────────────────────
    if (data.startsWith("xrn:")) {
      if (!ADMIN_IDS.includes(adminId)) return ctx.answerCbQuery("⛔ Доступ запрещён");
      try { await ctx.editMessageText("✅ Отклонение отзыва отменено."); } catch { }
      await ctx.answerCbQuery("Отменено");
      return;
    }

    // ── 📋 rr: preset review rejection reason selected ───────────────────
    if (data.startsWith("rr:")) {
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

      await ctx.answerCbQuery("✅ Отзыв отклонён");
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


    // ── 📸 review_hint: prompt user to send review screenshot ────────────
    if (data === CB.reviewHint) {
      // Restore pendingReview so the text handler can remind them if they type instead of sending a photo
      const tgUser = await (db as any).user.findUnique({ where: { tgId: adminId } });
      if (tgUser) {
        const reviewOrder = await (db as any).wbOrder.findFirst({
          where: { userId: tgUser.id, status: "COMPLETED", isDirectOrder: false },
          orderBy: { updatedAt: "desc" },
        });
        const linked = reviewOrder
          ? await (db as any).wbCode.findFirst({ where: { userId: tgUser.id, reviewBonusClaimed: false } })
          : null;
        if (reviewOrder && linked) {
          pendingReview.set(ctx.from.id, reviewOrder.id as string);
        }
      }
      await ctx.reply(
        "📸 Сделай скриншот своего отзыва на Wildberries и отправь его сюда фотографией (не файлом, не документом).\n\n" +
        "После проверки бонус <b>+100 R$</b> придёт автоматически.",
        { parse_mode: "HTML" }
      );
      await ctx.answerCbQuery();
      return;
    }

    // ── 🔄 refresh_status: user refresh ──────────────────────────────────
    if (data === CB.refreshStatus) {
      const { text, keyboard } = await buildStatusMessage(adminId);
      try {
        await ctx.editMessageText(text, {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          ...keyboard,
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
  amount: number,
  isDirectOrder: boolean
): Promise<void> {
  const completedCount = await (db as any).wbOrder.count({
    where: { userId: user.id, status: "COMPLETED" },
  });

  // Count WB-only completed orders (review prompt is only relevant for WB purchases)
  const wbCompletedCount = isDirectOrder ? await (db as any).wbOrder.count({
    where: { userId: user.id, status: "COMPLETED", isDirectOrder: false },
  }) : completedCount;

  let tgMsg: string;
  let vkMsg: string;

  const pendingLine =
    `\n\n📊 Проверить зачисление: <a href="https://www.roblox.com/transactions">roblox.com/transactions</a> → строка <b>Pending</b>`;
  const pendingLineVk =
    `\n\n📊 Проверить зачисление: https://www.roblox.com/transactions → строка Pending`;

  if (isDirectOrder) {
    if (completedCount <= 1) {
      tgMsg =
        `✅ <b>Заказ выкуплен!</b> Робуксы уже в пути 🚀\n\n` +
        `Roblox зачислит их в течение 5–7 дней — это их стандартный процесс.` +
        pendingLine + `\n\n` +
        `Спасибо, что выбрал RobloxBank! Заказывай ещё — мы всегда здесь 💛`;
    } else {
      tgMsg =
        `✅ Заказ выкуплен! Это уже твой <b>${completedCount}-й</b> заказ — спасибо за доверие! 💛\n\n` +
        `Робуксы появятся в течение 5–7 дней.` +
        pendingLine + `\n\n` +
        `Всё ли было удобно? Напиши нам — мы читаем каждое сообщение.`;
    }
    vkMsg = tgMsg.replace(/<\/?b>/g, "").replace(pendingLine, pendingLineVk).replace(/<a href="[^"]+">([^<]+)<\/a>/g, "$1");
  } else if (wbCompletedCount === 1) {
    // TIER 1: First WB order — review prompt
    tgMsg =
      `✅ <b>Заказ выкуплен!</b> Робуксы уже в пути 🚀\n\n` +
      `Roblox зачислит их в течение 5–7 дней — это их стандартный процесс.` +
      pendingLine + `\n\n` +
      `🎁 <b>Оставь отзыв и получи +100 R$ в подарок!</b>\n` +
      `Напиши отзыв на Wildberries, сделай скриншот и отправь его сюда (фотографией, не файлом). После проверки бонус начислим сразу!`;
    vkMsg =
      `✅ Заказ выкуплен! Робуксы уже в пути 🚀\n\n` +
      `Roblox зачислит их в течение 5–7 дней — это их стандартный процесс.` +
      pendingLineVk + `\n\n` +
      `Оставь отзыв и получи +100 R$ в подарок!\n` +
      `Напиши отзыв на Wildberries, сделай скриншот и отправь его в этот чат. После проверки бонус начислим сразу!`;
  } else {
    // TIER 2: Returning / VIP — direct order pitch
    console.log(`[CRM] Direct pitch sent for order #${completedCount}`);
    tgMsg =
      `✅ Заказ выкуплен! Это уже твой <b>${completedCount}-й</b> заказ в RobloxBank. Спасибо за доверие! 💛\n\n` +
      `Робуксы появятся в течение 5–7 дней.` +
      pendingLine + `\n\n` +
      `Кстати, для постоянных клиентов у нас есть закрытый формат. Чтобы не ждать поставок на Wildberries и оформлять заказы по самому выгодному курсу (без лишних комиссий), пиши нам в поддержку напрямую: @RobloxBank_PA\n\n` +
      `Это <b>быстрее, проще и всегда выгоднее</b>. Мы закрепим за тобой персональное обслуживание.\n\n` +
      `Всё ли было удобно в этот раз? Если есть идеи по улучшению — напиши в поддержку, мы читаем каждое сообщение!`;
    vkMsg =
      `✅ Заказ выкуплен! Это уже твой ${completedCount}-й заказ в RobloxBank. Спасибо за доверие! 💛\n\n` +
      `Робуксы появятся в течение 5–7 дней.` +
      pendingLineVk + `\n\n` +
      `Кстати, для постоянных клиентов у нас есть закрытый формат. Чтобы не ждать поставок на Wildberries и оформлять заказы по самому выгодному курсу (без лишних комиссий), пиши нам в поддержку напрямую: https://t.me/RobloxBank_PA\n\n` +
      `Это быстрее, проще и всегда выгоднее. Мы закрепим за тобой персональное обслуживание.\n\n` +
      `Всё ли было удобно в этот раз? Если есть идеи по улучшению — напиши в поддержку, мы читаем каждое сообщение!`;
  }

  if (user.tgId) {
    try {
      let keyboard: ReturnType<typeof Markup.inlineKeyboard>;
      if (!isDirectOrder && wbCompletedCount === 1) {
        keyboard = Markup.inlineKeyboard([
          [Markup.button.callback("📸 Оставить отзыв за +100 R$", CB.reviewHint)],
          [Markup.button.url("💬 Написать менеджеру", SUPPORT_URL)],
        ]);
        pendingReview.set(parseInt(user.tgId), orderId);
      } else {
        keyboard = Markup.inlineKeyboard([
          [Markup.button.callback("💎 Заказать напрямую", CB.startDirect)],
        ]);
      }
      await bot.telegram.sendMessage(user.tgId, tgMsg, { parse_mode: "HTML", ...keyboard });
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

  const isPrivateGame = reason.toLowerCase().includes("закрыт");
  const fixInstructions = isPrivateGame
    ? `Как исправить:\n` +
      `1. Нажми на плейс → <b>Configure → Settings</b> → Audience → выбери <b>Public</b>\n` +
      `   Не помогло? <b>Configure → Questionnaire → Restart</b> → ответь «No» на 10 вопросов\n` +
      `2. Установи цену геймпасса: <b>${Math.ceil(amount / 0.7)} R$</b>\n` +
      `3. Нажми кнопку ниже и пришли новую ссылку:`
    : `Чаще всего причина в одном из двух:\n` +
      `• Цена геймпасса неверная — нужно ${Math.ceil(amount / 0.7)} R$\n` +
      `• Геймпасс не выставлен на продажу\n\n` +
      `Исправь и нажми кнопку ниже, чтобы отправить ссылку заново:`;

  const msg =
    `❌ <b>Заявка #${shortId} отклонена</b>\n\n` +
    reasonLine +
    fixInstructions;

  if (user.tgId) {
    try {
      await bot.telegram.sendMessage(user.tgId, msg, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🔄 Исправить ссылку", `user_resubmit:${wbCode}:${amount}`)],
          [supportBtn("💬 Нужна помощь?", "rejected")],
        ])
      });
    } catch { }
  } else if (user.vkId) {
    await vkSend(user.vkId, stripHtml(msg) + "\n\nЧтобы исправить, просто пришли новую ссылку на геймпасс в этот чат.\nЕсли нужна помощь — https://t.me/RobloxBank_PA");
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
    `📸 Скриншот не подошёл: <b>${reason}</b>.\n\n` +
    `Пришли новый — бонус 100 R$ всё ещё ждёт тебя! 🎁`;

  const vkMsg =
    `📸 Скриншот не подошёл: ${reason}.\n\n` +
    `Пришли новый — бонус 100 R$ всё ещё ждёт тебя! 🎁`;

  if (user.tgId) {
    try {
      await bot.telegram.sendMessage(user.tgId, tgMsg, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([[supportBtn("💬 Нужна помощь?", "review_rej")]]),
      });
      // Restore review state so the next photo from this user is processed
      pendingReview.set(parseInt(user.tgId), orderId);
    } catch { }
  } else if (user.vkId) {
    await vkSend(user.vkId, vkMsg + "\n\nЕсли нужна помощь — https://t.me/RobloxBank_PA");
    // Restore VK review state — lazy import to avoid circular deps
    try {
      const { setState } = await import("../vk/session");
      setState(parseInt(user.vkId), { type: "AWAITING_REVIEW", orderId });
    } catch { }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// chat_member — fires when a user joins TG_CHANNEL_ID
// Requires the bot to be admin in the channel and "chat_member" in allowedUpdates.
// ─────────────────────────────────────────────────────────────────────────────

export function registerChatMember(bot: Telegraf): void {
  const channelId = process.env.TG_CHANNEL_ID;
  if (!channelId) return;

  bot.on("chat_member", async (ctx) => {
    const update = ctx.chatMember;
    // Only events from our subscription channel
    if (String(update.chat.id) !== channelId) return;

    const newStatus = update.new_chat_member.status;
    const oldStatus = update.old_chat_member.status;
    // Only when transitioning TO member/admin (joining)
    const isNowMember = ["member", "administrator", "creator"].includes(newStatus);
    const wasAlreadyMember = ["member", "administrator", "creator"].includes(oldStatus);
    if (!isNowMember || wasAlreadyMember) return;

    const userId = update.new_chat_member.user.id;
    const tgId = String(userId);

    try {
      const user = await (db as any).user.findUnique({ where: { tgId } });
      if (!user) return;

      const pendingOrder = await (db as any).wbOrder.findFirst({
        where: { userId: user.id, status: "AWAITING_GAMEPASS" },
        orderBy: { createdAt: "desc" },
      });
      if (!pendingOrder) return;

      const state = pendingLink.get(userId);
      const denomination = state?.denomination ?? pendingOrder.amount;
      const code = state?.wbCode ?? pendingOrder.wbCode;
      const passPrice = Math.ceil(denomination / 0.7);

      await bot.telegram.sendMessage(
        userId,
        `✅ <b>Добро пожаловать в канал!</b>\n\n` +
        `Твой код <code>${code}</code> активирован — осталось создать геймпасс.\n\n` +
        `📌 Установи цену ровно <b>${passPrice} R$</b>\n\n` +
        `Создай геймпасс и пришли ссылку прямо сюда 👇`,
        {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          ...Markup.inlineKeyboard([
            [Markup.button.url("📖 Открыть инструкцию", `https://www.robloxbank.ru/guide?source=wb&skip=1&code=${code}`)],
            [supportBtn("💬 Нужна помощь?")],
          ]),
        }
      );
    } catch (err) {
      console.error("[TG] chat_member handler error:", err);
    }
  });
}
