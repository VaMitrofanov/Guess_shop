/**
 * Periodic background jobs for the Telegram bot.
 * Called from bot.ts after bot.launch().
 */

import { Markup, type Telegraf } from "telegraf";
import { db } from "../shared/db";
import { CB, ADMIN_IDS } from "../shared/admin";
import { tgSend, vkSend, stripHtml } from "../shared/notify";

const BONUS_AMOUNT = 100;
const EXPIRY_DAYS = 30;
// reviewReminderLevel is incremented each time we send a reminder (1–4)
const REMINDER_SCHEDULE: Array<{ level: number; dayThreshold: number }> = [
  { level: 1, dayThreshold: 7  },
  { level: 2, dayThreshold: 14 },
  { level: 3, dayThreshold: 21 },
  { level: 4, dayThreshold: 27 },
];

async function processReviewReminders(bot: Telegraf): Promise<void> {
  const now = Date.now();

  const users = await (db as any).user.findMany({
    where: { reviewBonusGrantedAt: { not: null } },
    select: {
      id:                  true,
      tgId:                true,
      vkId:                true,
      balance:             true,
      reviewBonusGrantedAt: true,
      reviewReminderLevel: true,
    },
  });

  for (const user of users) {
    const grantedMs  = new Date(user.reviewBonusGrantedAt!).getTime();
    const daysSince  = (now - grantedMs) / 86_400_000;
    const expiryDate = new Date(grantedMs + EXPIRY_DAYS * 86_400_000);

    // ── Expire after 30 days ──────────────────────────────────────────────
    if (daysSince >= EXPIRY_DAYS) {
      await (db as any).user.update({
        where: { id: user.id },
        data: {
          balance:              { decrement: Math.min(BONUS_AMOUNT, user.balance) },
          reviewBonusGrantedAt: null,
          reviewReminderLevel:  0,
        },
      });

      const expiredMsg =
        `⏰ <b>Срок бонуса истёк.</b>\n\n` +
        `Ваш бонус <b>100 R$</b> за отзыв сгорел (действовал 30 дней, для прямых заказов от 1000 R$).\n\n` +
        `Купить робуксы напрямую можно в любое время:`;
      if (user.tgId) {
        try {
          await bot.telegram.sendMessage(user.tgId, expiredMsg, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback("💎 Купить напрямую", CB.startDirect)]]),
          });
        } catch { /* user may have blocked the bot */ }
      } else if (user.vkId) {
        // VK users used to lose the bonus silently — at least tell them.
        await vkSend(user.vkId, stripHtml(expiredMsg) + "\nНапиши «Начать» — покажу меню с кнопкой «💎 Купить напрямую».");
      }
      continue;
    }

    // ── Send scheduled reminders ──────────────────────────────────────────
    const scheduledLevel = REMINDER_SCHEDULE.filter(r => daysSince >= r.dayThreshold).at(-1);
    if (!scheduledLevel || scheduledLevel.level <= user.reviewReminderLevel) continue;

    const newLevel  = scheduledLevel.level;
    const daysLeft  = Math.ceil((expiryDate.getTime() - now) / 86_400_000);
    const expiryStr = expiryDate.toLocaleDateString("ru-RU", {
      day: "numeric", month: "long", timeZone: "Europe/Moscow",
    });

    let msg: string;
    if (newLevel === 4) {
      msg =
        `🚨 <b>Бонус сгорает через 3 дня!</b>\n\n` +
        `У вас есть <b>100 R$</b> на счёту — они действуют до <b>${expiryStr}</b>.\n\n` +
        `Оформите прямой заказ от 1000 R$ — бонус спишется автоматически.`;
    } else {
      msg =
        `💰 <b>Напоминание: у вас есть бонус 100 R$!</b>\n\n` +
        `Бонус за отзыв действует ещё <b>${daysLeft} ${daysWord(daysLeft)}</b> — до ${expiryStr}.\n\n` +
        `Используйте на прямой заказ от 1000 R$ (без карточки WB).`;
    }

    await (db as any).user.update({
      where: { id: user.id },
      data:  { reviewReminderLevel: newLevel },
    });

    if (user.tgId) {
      try {
        await bot.telegram.sendMessage(user.tgId, msg, {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("💎 Купить напрямую", CB.startDirect)]]),
        });
      } catch { }
    } else if (user.vkId) {
      await vkSend(user.vkId, stripHtml(msg) + "\nНапиши «Начать» — покажу меню с кнопкой «💎 Купить напрямую».");
    }
  }
}

function daysWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "дня";
  return "дней";
}

/* ── WB code stock alerts ─────────────────────────────────────────────────────
   Checks available WB codes per denomination every 30 min. When a denomination
   drops to LOW_THRESHOLD or CRITICAL_THRESHOLD, sends a one-time alert to
   admins. Resets when stock goes back above the threshold.
   ───────────────────────────────────────────────────────────────────────── */

const LOW_THRESHOLD      = 10;
const CRITICAL_THRESHOLD = 3;

const lastAlertLevel = new Map<number, "low" | "critical" | null>();

async function checkWbCodeStock(): Promise<void> {
  const groups: { denomination: number; _count: { _all: number } }[] =
    await (db as any).wbCode.groupBy({
      by: ["denomination"],
      where: { status: "AVAILABLE", isTest: false },
      _count: { _all: true },
    });

  const stockMap = new Map<number, number>();
  for (const g of groups) {
    stockMap.set(g.denomination, typeof g._count === "number" ? g._count : g._count._all);
  }

  // Also check denominations that have 0 available (not in groupBy result)
  const allDenoms: { denomination: number }[] = await (db as any).wbCode.findMany({
    distinct: ["denomination"],
    where: { isTest: false },
    select: { denomination: true },
  });
  for (const d of allDenoms) {
    if (!stockMap.has(d.denomination)) stockMap.set(d.denomination, 0);
  }

  const alerts: string[] = [];

  for (const [denom, available] of stockMap) {
    const prev = lastAlertLevel.get(denom) ?? null;

    if (available <= CRITICAL_THRESHOLD) {
      if (prev !== "critical") {
        alerts.push(
          available === 0
            ? `🔴 <b>${denom} R$</b> — закончились!`
            : `🔴 <b>${denom} R$</b> — осталось <b>${available}</b> шт (критично)`
        );
        lastAlertLevel.set(denom, "critical");
      }
    } else if (available <= LOW_THRESHOLD) {
      if (prev !== "low" && prev !== "critical") {
        alerts.push(`🟡 <b>${denom} R$</b> — осталось <b>${available}</b> шт`);
        lastAlertLevel.set(denom, "low");
      }
    } else {
      if (prev != null) lastAlertLevel.set(denom, null);
    }
  }

  if (alerts.length === 0) return;

  const msg =
    `📦 <b>Остаток карточек WB</b>\n\n` +
    alerts.join("\n") +
    `\n\n<i>Пополни запас в админке (Коды → загрузить CSV).</i>`;

  await Promise.allSettled(ADMIN_IDS.map(id => tgSend(id, msg)));
}

/* ── AWAITING_GAMEPASS reminders ──────────────────────────────────────────────
   Users who activated a code but haven't created a gamepass yet. Progressive
   nudges at 3h, 24h, 72h. No order deletion — just reminders.
   ───────────────────────────────────────────────────────────────────────── */

const AWAITING_SCHEDULE: Array<{ sent: number; hoursThreshold: number }> = [
  { sent: 0, hoursThreshold: 3 },
  { sent: 1, hoursThreshold: 24 },
  { sent: 2, hoursThreshold: 72 },
];

function buildReminderMsg(level: number, guideUrl: string): string {
  if (level === 1) {
    return (
      `👋 Привет! Чтобы получить робуксы, осталось совсем немного:\n\n` +
      `1. Создай геймпасс на Roblox (по инструкции — 5 минут)\n` +
      `2. Найди его по нику на сайте\n` +
      `3. Подтверди — и мы выкупим!\n\n` +
      `📖 <a href="${guideUrl}">Открыть инструкцию</a>`
    );
  }
  if (level === 2) {
    return (
      `Напоминаю — геймпасс ещё не создан. Пока заказ не оформлен, робуксы не придут.\n\n` +
      `Всё просто: создай геймпасс → найди по нику → готово 🙌\n\n` +
      `📖 <a href="${guideUrl}">Открыть инструкцию</a>`
    );
  }
  return (
    `Последнее напоминание: геймпасс всё ещё ждёт создания.\n` +
    `Если нужна помощь — напиши, поможем разобраться 💬\n\n` +
    `📖 <a href="${guideUrl}">Открыть инструкцию</a>`
  );
}

function buildReminderMsgPlain(level: number, guideUrl: string): string {
  if (level === 1) {
    return (
      `👋 Привет! Чтобы получить робуксы, осталось совсем немного:\n\n` +
      `1. Создай геймпасс на Roblox (по инструкции — 5 минут)\n` +
      `2. Найди его по нику на сайте\n` +
      `3. Подтверди — и мы выкупим!\n\n` +
      `📖 Инструкция: ${guideUrl}`
    );
  }
  if (level === 2) {
    return (
      `Напоминаю — геймпасс ещё не создан. Пока заказ не оформлен, робуксы не придут.\n\n` +
      `Всё просто: создай геймпасс → найди по нику → готово 🙌\n\n` +
      `📖 Инструкция: ${guideUrl}`
    );
  }
  return (
    `Последнее напоминание: геймпасс всё ещё ждёт создания.\n` +
    `Если нужна помощь — напиши, поможем разобраться 💬\n\n` +
    `📖 Инструкция: ${guideUrl}`
  );
}

async function processAwaitingReminders(bot: Telegraf): Promise<void> {
  const now = Date.now();

  const orders = await (db as any).wbOrder.findMany({
    where: {
      status: "AWAITING_GAMEPASS",
      remindersSent: { lt: 3 },
      isTest: false,
    },
    include: {
      user: { select: { tgId: true, vkId: true } },
    },
  });

  for (const order of orders) {
    const ageHours = (now - new Date(order.createdAt).getTime()) / 3_600_000;
    const scheduled = AWAITING_SCHEDULE.find(
      s => s.sent === order.remindersSent && ageHours >= s.hoursThreshold
    );
    if (!scheduled) continue;

    const newLevel = order.remindersSent + 1;
    const guideUrl = `https://robloxbank.ru/guide?source=wb&skip=1&code=${order.wbCode}`;

    await (db as any).wbOrder.update({
      where: { id: order.id },
      data: { remindersSent: newLevel },
    });

    if (order.user.tgId) {
      try {
        const extra: Record<string, unknown> = {
          parse_mode: "HTML",
          disable_web_page_preview: true,
        };
        if (newLevel === 3) {
          extra.reply_markup = {
            inline_keyboard: [
              [{ text: "📖 ОТКРЫТЬ ИНСТРУКЦИЮ", url: guideUrl }],
              [{ text: "🔎 Ввести ник Roblox", callback_data: "find_nick" }],
            ],
          };
        } else {
          extra.reply_markup = {
            inline_keyboard: [
              [{ text: "📖 ОТКРЫТЬ ИНСТРУКЦИЮ", url: guideUrl }],
            ],
          };
        }
        await bot.telegram.sendMessage(
          order.user.tgId,
          buildReminderMsg(newLevel, guideUrl),
          extra,
        );
      } catch { }
    } else if (order.user.vkId) {
      try {
        await vkSend(order.user.vkId, buildReminderMsgPlain(newLevel, guideUrl));
      } catch { }
    }
  }
}

export function startReviewReminderCron(bot: Telegraf): void {
  // Run once shortly after startup, then every hour
  setTimeout(() => {
    processReviewReminders(bot).catch(err =>
      console.error("[ReviewReminder] error:", err)
    );
  }, 30_000); // 30 s after boot

  setInterval(() => {
    processReviewReminders(bot).catch(err =>
      console.error("[ReviewReminder] error:", err)
    );
  }, 60 * 60 * 1000); // every 1 hour

  // WB stock alert — check every 30 minutes
  setTimeout(() => {
    checkWbCodeStock().catch(err =>
      console.error("[StockAlert] error:", err)
    );
  }, 60_000); // 1 min after boot

  setInterval(() => {
    checkWbCodeStock().catch(err =>
      console.error("[StockAlert] error:", err)
    );
  }, 30 * 60 * 1000); // every 30 min

  // AWAITING_GAMEPASS reminders — check every 2 hours
  setTimeout(() => {
    processAwaitingReminders(bot).catch(err =>
      console.error("[AwaitingReminder] error:", err)
    );
  }, 45_000); // 45 s after boot

  setInterval(() => {
    processAwaitingReminders(bot).catch(err =>
      console.error("[AwaitingReminder] error:", err)
    );
  }, 2 * 60 * 60 * 1000); // every 2 hours

  console.log("[ReviewReminder] Cron started ✅");
  console.log("[StockAlert] Cron started ✅");
  console.log("[AwaitingReminder] Cron started ✅");
}
