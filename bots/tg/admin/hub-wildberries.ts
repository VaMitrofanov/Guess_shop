/**
 * 🟣 Wildberries Hub — admin analytics dashboard.
 *
 * Screens:
 *  - Main hub: today/yesterday, top products, stock alerts, FBS badge
 *  - Stocks & Runway: per-article stock with days-remaining forecast
 *  - Dynamics: this week vs last week with per-day bar chart
 *  - Unit Economics: profit calculator per product
 *  - Reviews: unanswered reviews & questions with inline reply
 *  - FBS: marketplace orders list
 *  - Products: price editing (unchanged from v1)
 *  - Codes: add / download (unchanged from v1)
 *  - Analytics: activation bar chart (unchanged from v1)
 */

import { Markup, type Context, type Telegraf } from "telegraf";
import { db } from "../../shared/db";
import { CB, ADMIN_IDS } from "../../shared/admin";
import { sendOrEditWidget, editWidget } from "./widgets";
import {
  getTodayStats, getYesterdayStats, getTopProducts,
  getStocks, getStocksWithRunway, getCampaignsStatus,
  getProducts, getWeeklyStats, getPrevWeekStats, getDailyBreakdown,
  getUnansweredReviews, answerReview, captureNotifyState, flushFbsDigest,
  getFbsOrders, updatePrice,
  type WbStockWithRunway,
} from "./wb-client";
import {
  pendingCodesInput, pendingPriceInput,
  pendingReviewAnswer, pendingCostInput, pendingLogisticsInput,
} from "../session";

// ── Formatting helpers ───────────────────────────────────────────────────────

function rub(n: number): string {
  return n.toLocaleString("ru-RU") + " ₽";
}

function pct(now: number, prev: number): string {
  if (prev === 0) return prev === now ? "—" : "🆕";
  const d = Math.round(((now - prev) / prev) * 100);
  return d > 0 ? `+${d}% ↑` : d < 0 ? `${d}% ↓` : "0%";
}

function runwayIcon(days: number): string {
  if (days >= 14) return "🟢";
  if (days >= 7)  return "🟡";
  if (days > 0)   return "🔴";
  return "⚫";
}

function stockIcon(count: number): string {
  if (count >= 10) return "🟢";
  if (count >= 3)  return "🟡";
  return "🔴";
}

function stars(n?: number): string {
  if (!n) return "";
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

// ── Main Hub ─────────────────────────────────────────────────────────────────

function mainKeyboard(reviewCount: number, fbsCount: number) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("📦 Склады & Остатки", CB.wbStocks),
      Markup.button.callback("📈 Динамика", CB.wbDynamics),
    ],
    [
      Markup.button.callback(reviewCount > 0 ? `⭐ Отзывы (${reviewCount})` : "⭐ Отзывы", CB.wbReviews),
      Markup.button.callback("🧩 Юнит-экономика", CB.wbUnitEcon),
    ],
    [
      Markup.button.callback(fbsCount > 0 ? `🚚 FBS (${fbsCount})` : "🚚 FBS заказы", CB.wbFbs),
      Markup.button.callback("🏷️ Товары", CB.wbProducts),
    ],
    [
      Markup.button.callback("📊 Активации", CB.wbAnalytics),
      Markup.button.callback("➕ Добавить коды", CB.wbAddCodes),
    ],
    [Markup.button.callback("🔄 Обновить", CB.wbRefresh)],
  ]);
}

export async function showWildberriesHub(ctx: Context): Promise<void> {
  const { text, reviewCount, fbsCount } = await buildWbText();
  await sendOrEditWidget(ctx, text, mainKeyboard(reviewCount, fbsCount));
}

export async function refreshWb(ctx: Context, bot?: Telegraf): Promise<void> {
  const { text, reviewCount, fbsCount, lowStockArticles } = await buildWbText();
  await editWidget(ctx, text, mainKeyboard(reviewCount, fbsCount));

  // Push notifications on state changes
  if (bot) {
    const prev = captureNotifyState(fbsCount, reviewCount, lowStockArticles);
    if (prev) {
      const newFbs = fbsCount - prev.fbsCount;
      if (newFbs > 0) {
        for (const adminId of ADMIN_IDS) {
          await bot.telegram.sendMessage(adminId,
            `🆕 <b>FBS: ${newFbs} новых заказ${newFbs === 1 ? "" : "а"}!</b>\nВсего в работе: ${fbsCount}`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }
      }
      const newLowStock = lowStockArticles.filter(a => !prev.lowStockArticles.includes(a));
      for (const article of newLowStock) {
        for (const adminId of ADMIN_IDS) {
          await bot.telegram.sendMessage(adminId,
            `⚠️ <b>Low Stock Alert</b>\nАртикул <code>${article}</code> заканчивается!\nПора заказывать поставку.`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }
      }
      const newReviews = reviewCount - prev.reviewCount;
      if (newReviews > 0) {
        for (const adminId of ADMIN_IDS) {
          await bot.telegram.sendMessage(adminId,
            `⭐ <b>${newReviews} новых отзыв${newReviews === 1 ? "" : "а"} на WB!</b>`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }
      }
    }
  }
}

/**
 * Call once at bot startup to begin background WB monitoring (every 15 min).
 *
 * Notification policy:
 *  - FBS orders:   hourly digest — accumulates delta across cycles, sends one
 *                  message per hour. Avoids spam at 100+ orders/day.
 *  - Low stock:    immediate — each newly-critical article fires once.
 *  - Reviews:      immediate — fires once per cycle if count increased.
 */
export function startWbMonitor(bot: Telegraf, intervalMs = 15 * 60 * 1000): void {
  setInterval(async () => {
    try {
      const [fbs, stocks, reviews] = await Promise.all([
        getFbsOrders(),
        getStocksWithRunway(),
        getUnansweredReviews(),
      ]);
      const fbsCount         = fbs?.length ?? 0;
      const reviewCount      = reviews.length;
      const lowStockArticles = (stocks ?? [])
        .filter(s => s.runwayDays < 7 && s.runwayDays > 0)
        .map(s => s.article);

      const prev = captureNotifyState(fbsCount, reviewCount, lowStockArticles);
      if (!prev) return;

      // ── FBS: hourly digest ───────────────────────────────────────────────
      const newFbs    = fbsCount - prev.fbsCount;
      const digestBatch = flushFbsDigest(newFbs);
      if (digestBatch > 0) {
        const orderWord = digestBatch === 1 ? "заказ" : digestBatch < 5 ? "заказа" : "заказов";
        for (const adminId of ADMIN_IDS) {
          await bot.telegram.sendMessage(adminId,
            `🛒 <b>FBS: +${digestBatch} ${orderWord} за час</b>\nВсего в работе: <b>${fbsCount}</b>`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }
      }

      // ── Low stock: immediate, one message per newly-critical article ─────
      const newLowStock = lowStockArticles.filter(a => !prev.lowStockArticles.includes(a));
      if (newLowStock.length > 0) {
        const detail = newLowStock.map(a => {
          const s = stocks?.find(st => st.article === a);
          return `  • <code>${a}</code> — ${s?.quantity ?? "?"} шт (${s?.runwayDays ?? "?"}д)`;
        }).join("\n");
        for (const adminId of ADMIN_IDS) {
          await bot.telegram.sendMessage(adminId,
            `⚠️ <b>Low Stock Alert (${newLowStock.length} арт.)</b>\n${detail}\nПора заказывать поставку.`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }
      }

      // ── Reviews: immediate ───────────────────────────────────────────────
      const newReviews = reviewCount - prev.reviewCount;
      if (newReviews > 0) {
        const reviewWord = newReviews === 1 ? "отзыв" : newReviews < 5 ? "отзыва" : "отзывов";
        for (const adminId of ADMIN_IDS) {
          await bot.telegram.sendMessage(adminId,
            `⭐ <b>${newReviews} новых ${reviewWord} на WB!</b> Откройте раздел «Отзывы» в боте.`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }
      }
    } catch (err) {
      console.error("WB monitor error:", err);
    }
  }, intervalMs);
}

async function buildWbText(): Promise<{
  text: string;
  reviewCount: number;
  fbsCount: number;
  lowStockArticles: string[];
}> {
  const now = new Date();

  // ── DB: code inventory ───────────────────────────────────────────────────
  const [groups, totalAvailable] = await Promise.all([
    (db as any).wbCode.groupBy({
      by: ["denomination"],
      _count: { _all: true },
      where: { isUsed: false },
    }),
    (db as any).wbCode.count({ where: { isUsed: false } }),
  ]);
  groups.sort((a: any, b: any) => a.denomination - b.denomination);

  // ── WB API data ───────────────────────────────────────────────────────────
  const [todayStats, stocks, campaigns, fbs, reviews] = await Promise.all([
    getTodayStats(),
    getStocksWithRunway(),
    getCampaignsStatus(),
    getFbsOrders(),
    getUnansweredReviews(),
  ]);

  const yesterdayStats = getYesterdayStats();
  const top            = getTopProducts(3);
  const fbsCount       = fbs?.length ?? 0;
  const reviewCount    = reviews.length;

  const totalStock   = (stocks ?? []).reduce((a, s) => a + s.quantity, 0);
  const inTransit    = fbs?.filter((o: any) => o.wbStatus === "sorted_for_client" || o.wbStatus === "sold_not_uploaded").length ?? 0;
  const lowStock     = (stocks ?? []).filter(s => s.runwayDays < 7 && s.runwayDays > 0);
  const lowStockArticles = lowStock.map(s => s.article);

  const apiDown = !todayStats && !stocks && !campaigns;
  const stale   = !todayStats && (stocks || campaigns);

  const timeStr = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const dateStr = (d: Date) => d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" });

  // ── Assemble message ──────────────────────────────────────────────────────
  let lines: string[] = [];

  lines.push(`🟣 <b>WILDBERRIES</b>`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push("");

  if (apiDown) {
    lines.push(`⚠️ <b>API недоступно или неверный WB_API_TOKEN</b>`);
    lines.push(`Данные ниже — только из базы бота.`);
  } else {
    if (stale) lines.push(`⚠️ <i>Данные частично устарели (API занят)</i>`);

    // Today
    lines.push(`📅 <b>Сегодня, ${dateStr(now)}</b>`);
    if (todayStats) {
      const cancelOrders = todayStats.ordersCount - todayStats.salesCount;
      const buyoutPct    = todayStats.ordersCount > 0
        ? Math.round((todayStats.salesCount / todayStats.ordersCount) * 100)
        : 0;
      lines.push(
        `<code>` +
        `💰 Выручка: ${pad(rub(todayStats.salesSum), 14)}` +
        `📦 Заказов: ${todayStats.ordersCount} шт\n` +
        `🛒 Выкуп:   ${pad(`${todayStats.salesCount} шт (${buyoutPct}%)`, 14)}` +
        `❌ Отмен:   ${cancelOrders} шт` +
        `</code>`
      );
    } else {
      lines.push(`<i>Статистика загружается…</i>`);
    }
    lines.push("");

    // Yesterday + delta
    if (yesterdayStats && todayStats) {
      const d = now;
      d.setDate(d.getDate() - 1);
      lines.push(`📅 <b>Вчера, ${dateStr(d)}</b>`);
      lines.push(
        `<code>` +
        `💰 ${rub(yesterdayStats.salesSum)}  ${pct(todayStats.salesSum, yesterdayStats.salesSum)}\n` +
        `📦 ${yesterdayStats.ordersCount} шт` +
        `</code>`
      );
      lines.push("");
    }

    // Top products
    if (top.length > 0) {
      lines.push(`🔝 <b>Топ за сегодня</b>`);
      lines.push(`<code>`);
      top.forEach((p, i) => {
        lines.push(`${i + 1}. ${pad(p.article, 12)}  ${pad(rub(p.sum), 10)}  ${p.count}шт`);
      });
      lines.push(`</code>`);
      lines.push("");
    }

    // Stocks summary
    lines.push(`📦 <b>Склады</b>`);
    if (stocks && stocks.length > 0) {
      lines.push(`<code>FBO: ${totalStock} шт  │  🚚 FBS в работе: ${fbsCount}</code>`);
      if (lowStock.length > 0) {
        lines.push(`⚠️ Заканчивается: ${lowStock.length} арт. (<7 дней)`);
        lowStock.slice(0, 2).forEach(s =>
          lines.push(`  • <code>${s.article}</code> — ${s.quantity} шт (${s.runwayDays}д) ${runwayIcon(s.runwayDays)}`)
        );
      }
    } else if (!stocks) {
      lines.push(`<i>Ошибка загрузки складов</i>`);
    } else {
      lines.push(`<code>Склад пуст</code>`);
    }
    lines.push("");

    // Ads
    if (campaigns) {
      lines.push(`📈 <b>Реклама:</b> ${campaigns}`);
      lines.push("");
    }
  }

  // DB codes
  lines.push(`🗃 <b>Коды WB в боте (${totalAvailable} шт)</b>`);
  if (groups.length === 0) {
    lines.push(`⚠️ <b>Нет кодов!</b>`);
  } else {
    lines.push(`<code>`);
    for (const g of groups) {
      const cnt = g._count._all;
      lines.push(`${stockIcon(cnt)} ${pad(`${g.denomination} R$`, 8)} ${cnt} шт`);
    }
    lines.push(`</code>`);
  }

  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`<i>🔄 ${timeStr}${stale ? " (кэш)" : ""}</i>`);

  return {
    text: lines.join("\n"),
    reviewCount,
    fbsCount,
    lowStockArticles,
  };
}

// ── Stocks & Runway ──────────────────────────────────────────────────────────

export async function showStocksHub(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const stocks = await getStocksWithRunway();

  let lines: string[] = [];
  lines.push(`📦 <b>СКЛАДЫ & ОСТАТКИ</b>`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push("");

  if (!stocks) {
    lines.push(`⚠️ <b>Ошибка загрузки.</b> Проверьте WB_API_TOKEN.`);
  } else if (stocks.length === 0) {
    lines.push(`Склады пусты.`);
  } else {
    // Bloomberg-style pipe table — all groups in one block for fast scanning
    lines.push(`<code>`);
    lines.push(`Артикул       | Склад |  Ср/д | Дней`);
    lines.push(`──────────────|───────|───────|──────`);
    for (const s of stocks) {
      const icon     = runwayIcon(s.runwayDays);
      const runway   = s.runwayDays > 998 ? "  ∞" : pad(String(s.runwayDays), 3);
      const alert    = s.runwayDays < 7 ? " ⚠️" : "";
      const art      = pad(s.article.slice(0, 12), 12);
      const qty      = pad(String(s.quantity), 5);
      const avg      = pad(String(s.avgDailySales), 5);
      lines.push(`${art} | ${qty} | ${avg} | ${runway} ${icon}${alert}`);
    }
    lines.push(`</code>`);
    lines.push("");
    const total    = stocks.reduce((a, s) => a + s.quantity, 0);
    const critical = stocks.filter(s => s.runwayDays < 7 && s.runwayDays > 0).length;
    lines.push(`<b>Итого: ${total} шт</b>${critical > 0 ? `  ⚠️ Срочно пополнить: ${critical} арт.` : "  ✅ Всё в норме"}`);
  }

  await editWidget(ctx, lines.join("\n"), Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Назад", CB.hubWildberries), Markup.button.callback("🔄 Обновить", CB.wbStocks)],
  ]));
}

// ── Dynamics ─────────────────────────────────────────────────────────────────

export async function showDynamicsHub(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const weekly   = await getWeeklyStats();
  const prevWeek = getPrevWeekStats();
  const daily    = getDailyBreakdown(7);

  let lines: string[] = [];
  lines.push(`📈 <b>ДИНАМИКА: эта неделя vs прошлая</b>`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push("");

  if (weekly && prevWeek) {
    const todayStats = await getTodayStats();
    const weekSalesSum = daily.reduce((a, d) => a + d.sum, 0);
    lines.push(`<code>`);
    lines.push(`${pad("", 12)} ${pad("Эта", 8)} ${pad("Пред.", 8)}   Δ`);
    lines.push(`─────────────────────────────────`);
    lines.push(`${pad("Заказы:", 12)} ${pad(String(weekly.orders), 8)} ${pad(String(prevWeek.orders), 8)}   ${pct(weekly.orders, prevWeek.orders)}`);
    lines.push(`${pad("Выручка:", 12)} ${pad(rub(weekSalesSum), 8)} ${pad(rub(prevWeek.salesSum), 8)}   ${pct(weekSalesSum, prevWeek.salesSum)}`);
    if (todayStats) {
      lines.push(`${pad("Выкупы:", 12)} ${pad(String(weekly.sales), 8)} —             —`);
    }
    lines.push(`</code>`);
    lines.push("");
  }

  if (daily.length > 0) {
    const maxCount = Math.max(...daily.map(d => d.count), 1);
    lines.push(`<b>📊 Заказы по дням</b>`);
    lines.push(`<code>`);
    for (const d of daily) {
      const barLen = Math.round((d.count / maxCount) * 10);
      const bar = "█".repeat(barLen) + "░".repeat(10 - barLen);
      lines.push(`${d.date}  ${bar}  ${d.count}`);
    }
    lines.push(`</code>`);
  } else {
    lines.push(`<i>Недостаточно данных для графика.\nОбновите основной дашборд для загрузки 30-дневной статистики.</i>`);
  }

  await editWidget(ctx, lines.join("\n"), Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Назад", CB.hubWildberries)],
  ]));
}

// ── Unit Economics ────────────────────────────────────────────────────────────

const LOGISTICS_STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function showUnitEconHub(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const products = await getProducts();

  let lines: string[] = [];
  lines.push(`🧩 <b>ЮНИТ-ЭКОНОМИКА</b>`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push("");

  if (!products || products.length === 0) {
    lines.push(`⚠️ Товары не загружены. Попробуйте позже.`);
    await editWidget(ctx, lines.join("\n"), Markup.inlineKeyboard([[Markup.button.callback("◀️ Назад", CB.hubWildberries)]]));
    return;
  }

  const nmIds = products.map(p => p.nmID);
  const costs: any[] = await (db as any).wbProductCost.findMany({
    where: { nmID: { in: nmIds } },
  });
  const costMap = new Map(costs.map((c: any) => [c.nmID, c]));

  // ── Logistics staleness check ────────────────────────────────────────────
  // WB changes logistics rates unilaterally. Warn if any record is >30 days old.
  const now = Date.now();
  const staleLogistics = costs.filter(c =>
    now - new Date(c.updatedAt).getTime() > LOGISTICS_STALE_MS
  );
  if (staleLogistics.length > 0) {
    lines.push(
      `⚠️ <b>Внимание: логистика устарела!</b>\n` +
      `${staleLogistics.length} товар(а) не обновлялись >30 дней.\n` +
      `Сверьтесь с отчётом реализации WB и обновите ставку ниже.`
    );
    lines.push("");
  }

  const buttons: any[] = [];

  for (const p of products) {
    const cost  = costMap.get(p.nmID);
    const price = p.discountedPrice ?? p.price ?? 0;
    const title = (p.title || p.vendorCode).slice(0, 20);

    lines.push(`🔸 <b>${title}</b>  <code>${p.vendorCode}</code>`);
    if (!cost) {
      lines.push(`  <i>⚙️ Себестоимость не указана</i>`);
      buttons.push([Markup.button.callback(`✏️ Добавить себест. (${p.vendorCode})`, CB.wbEditCost(p.nmID))]);
    } else {
      const commission = Math.round(price * cost.wbCommission);
      const tax        = Math.round(price * cost.taxRate);
      const logistics  = cost.logisticsCost;
      const netProfit  = price - cost.costPrice - commission - logistics - tax;
      const margin     = price > 0 ? Math.round((netProfit / price) * 100) : 0;
      const logStale   = now - new Date(cost.updatedAt).getTime() > LOGISTICS_STALE_MS;

      lines.push(
        `<code>` +
        `  Цена продажи:    ${pad(rub(price), 10)}\n` +
        `  Себестоимость: −${pad(rub(cost.costPrice), 10)}\n` +
        `  Комиссия WB:   −${pad(rub(commission), 10)}  (${Math.round(cost.wbCommission * 100)}%)\n` +
        `  Логистика:     −${pad(rub(logistics), 10)}${logStale ? "  ⚠️" : ""}\n` +
        `  Налог:         −${pad(rub(tax), 10)}  (${Math.round(cost.taxRate * 100)}%)\n` +
        `  ────────────────────────────\n` +
        `  Прибыль:        ${pad(rub(netProfit), 10)}  (${margin}%)` +
        `</code>`
      );
      // Two edit buttons per product: cost price + logistics cost
      buttons.push([
        Markup.button.callback(`✏️ Себест. (${p.vendorCode})`,   CB.wbEditCost(p.nmID)),
        Markup.button.callback(`🚚 Логист. (${p.vendorCode})`,    CB.wbEditLogistics(p.nmID)),
      ]);
    }
    lines.push("");
  }

  buttons.push([Markup.button.callback("◀️ Назад", CB.hubWildberries)]);
  await editWidget(ctx, lines.join("\n"), Markup.inlineKeyboard(buttons));
}

export async function enterCostInput(ctx: Context, nmID: number): Promise<void> {
  await ctx.answerCbQuery();
  const products = await getProducts();
  const product  = products?.find(p => p.nmID === nmID);
  if (!product) {
    await ctx.answerCbQuery("Товар не найден");
    return;
  }

  pendingCostInput.set(ctx.from!.id, { nmID, vendorCode: product.vendorCode });

  const existing: any = await (db as any).wbProductCost.findUnique({ where: { nmID } });

  await editWidget(
    ctx,
    `✏️ <b>СЕБЕСТОИМОСТЬ — ${product.vendorCode}</b>\n━━━━━━━━━━━━━━━━\n\n` +
    (existing ? `Текущая: <b>${rub(existing.costPrice)}</b>\n\n` : "") +
    `Введите <b>себестоимость в рублях</b> (цена закупки/производства одной единицы).\n\n` +
    `<i>Комиссия WB (15%) и налог (6%) рассчитаются автоматически.\nЧтобы изменить ставки — обратитесь к разработчику.</i>`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Отмена", CB.wbUnitEcon)]])
  );
}

export async function handleCostInput(ctx: Context, text: string): Promise<boolean> {
  const state = pendingCostInput.get(ctx.from!.id);
  if (!state) return false;
  pendingCostInput.delete(ctx.from!.id);

  const cost = parseInt(text.trim());
  if (isNaN(cost) || cost <= 0) {
    await ctx.reply("❌ Некорректное число. Введите положительное целое (руб.).");
    return true;
  }

  await (db as any).wbProductCost.upsert({
    where:  { nmID: state.nmID },
    update: { costPrice: cost, vendorCode: state.vendorCode },
    create: { nmID: state.nmID, vendorCode: state.vendorCode, costPrice: cost },
  });

  await ctx.reply(`✅ Себестоимость для <code>${state.vendorCode}</code> — <b>${rub(cost)}</b> сохранена.`, { parse_mode: "HTML" });
  await showUnitEconHub(ctx);
  return true;
}

export async function enterLogisticsInput(ctx: Context, nmID: number): Promise<void> {
  await ctx.answerCbQuery();
  const products = await getProducts();
  const product  = products?.find(p => p.nmID === nmID);
  if (!product) { await ctx.answerCbQuery("Товар не найден"); return; }

  pendingLogisticsInput.set(ctx.from!.id, { nmID, vendorCode: product.vendorCode });

  const existing: any = await (db as any).wbProductCost.findUnique({ where: { nmID } });

  await editWidget(
    ctx,
    `🚚 <b>СТОИМОСТЬ ЛОГИСТИКИ — ${product.vendorCode}</b>\n━━━━━━━━━━━━━━━━\n\n` +
    (existing ? `Текущая: <b>${existing.logisticsCost} ₽</b>\n\n` : "") +
    `Введите <b>фактическую стоимость доставки одной единицы</b> (₽).\n\n` +
    `<i>Смотрите в отчёте реализации WB:\n«Услуги по доставке» ÷ кол-во доставленных единиц.\nОбычно 60–120 ₽ в зависимости от категории и региона.</i>`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Отмена", CB.wbUnitEcon)]])
  );
}

export async function handleLogisticsInput(ctx: Context, text: string): Promise<boolean> {
  const state = pendingLogisticsInput.get(ctx.from!.id);
  if (!state) return false;
  pendingLogisticsInput.delete(ctx.from!.id);

  const cost = parseInt(text.trim());
  if (isNaN(cost) || cost <= 0 || cost > 5000) {
    await ctx.reply("❌ Некорректное число. Введите стоимость в ₽ (от 1 до 5000).");
    return true;
  }

  await (db as any).wbProductCost.upsert({
    where:  { nmID: state.nmID },
    update: { logisticsCost: cost },
    create: { nmID: state.nmID, vendorCode: state.vendorCode, costPrice: 0, logisticsCost: cost },
  });

  await ctx.reply(
    `✅ Логистика для <code>${state.vendorCode}</code> — <b>${cost} ₽</b> сохранена.\nЗначение обновлено, дата проверки обнулена.`,
    { parse_mode: "HTML" }
  );
  await showUnitEconHub(ctx);
  return true;
}

// ── Reviews & Questions ───────────────────────────────────────────────────────

export async function showReviewsHub(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const reviews = await getUnansweredReviews();

  let lines: string[] = [];
  lines.push(`⭐ <b>ОТЗЫВЫ И ВОПРОСЫ</b>`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push("");

  const buttons: any[] = [];

  if (reviews.length === 0) {
    lines.push(`✅ <b>Нет неотвеченных обращений.</b>`);
  } else {
    for (const r of reviews.slice(0, 5)) {
      const dateStr = new Date(r.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
      const icon    = r.kind === "review" ? "⭐" : "❓";
      const starsStr = r.kind === "review" && r.stars ? ` ${stars(r.stars)}` : "";
      const preview = r.text.slice(0, 120) + (r.text.length > 120 ? "…" : "");

      lines.push(
        `${icon} <b>${r.author}</b>${starsStr} · ${dateStr}\n` +
        (r.article ? `<code>${r.article}</code>\n` : "") +
        `"${preview}"`
      );
      lines.push("");

      const cb = r.kind === "review" ? CB.wbAnswerReview(r.id) : CB.wbAnswerQuestion(r.id);
      const label = r.kind === "review" ? `✍️ Ответить на отзыв` : `✍️ Ответить на вопрос`;
      buttons.push([Markup.button.callback(label, cb)]);
    }

    if (reviews.length > 5) {
      lines.push(`<i>…ещё ${reviews.length - 5} неотвеченных</i>`);
    }
  }

  buttons.push([Markup.button.callback("◀️ Назад", CB.hubWildberries), Markup.button.callback("🔄 Обновить", CB.wbReviews)]);
  await editWidget(ctx, lines.join("\n"), Markup.inlineKeyboard(buttons));
}

export async function enterReviewAnswer(ctx: Context, id: string, isQuestion: boolean): Promise<void> {
  await ctx.answerCbQuery();
  const reviews = await getUnansweredReviews();
  const review  = reviews.find(r => r.id === id);
  if (!review) {
    await ctx.answerCbQuery("Не найдено");
    return;
  }

  pendingReviewAnswer.set(ctx.from!.id, { id, isQuestion, article: review.article });

  const icon = isQuestion ? "❓" : "⭐";
  await editWidget(
    ctx,
    `${icon} <b>ОТВЕТ НА ${isQuestion ? "ВОПРОС" : "ОТЗЫВ"}</b>\n━━━━━━━━━━━━━━━━\n\n` +
    `<i>${review.author} · ${review.article}</i>\n` +
    `"${review.text.slice(0, 200)}"\n\n` +
    `Напишите ответ:`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Отмена", CB.wbReviews)]])
  );
}

export async function handleReviewAnswer(ctx: Context, text: string): Promise<boolean> {
  const state = pendingReviewAnswer.get(ctx.from!.id);
  if (!state) return false;
  pendingReviewAnswer.delete(ctx.from!.id);

  if (text.length < 5) {
    await ctx.reply("❌ Ответ слишком короткий (минимум 5 символов).");
    return true;
  }

  const ok = await answerReview(state.id, text, state.isQuestion);
  if (ok) {
    await ctx.reply(`✅ Ответ опубликован на WB!`, { parse_mode: "HTML" });
    await showReviewsHub(ctx);
  } else {
    await ctx.reply("❌ Ошибка публикации ответа. Проверьте права токена (нужен токен от Контента/Отзывов).");
  }
  return true;
}

// ── FBS Orders ───────────────────────────────────────────────────────────────

export async function showFbsHub(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const fbs = await getFbsOrders();

  let lines: string[] = [];
  lines.push(`🚚 <b>FBS ЗАКАЗЫ (маркетплейс)</b>`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push("");

  if (!fbs) {
    lines.push(`⚠️ Ошибка загрузки. Проверьте WB_API_TOKEN.`);
  } else if (fbs.length === 0) {
    lines.push(`✅ <b>Активных FBS заказов нет.</b>`);
  } else {
    lines.push(`<b>Всего в работе: ${fbs.length} шт</b>\n`);
    lines.push(`<code>`);
    lines.push(`${pad("Дата", 8)}  ${pad("Арт.", 14)}  ${pad("Цена", 8)}  Статус`);
    lines.push(`──────────────────────────────────────`);
    for (const o of fbs.slice(0, 15)) {
      const dateStr = new Date(o.createdAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
      const price   = typeof o.convertedPrice === "number" ? rub(Math.round(o.convertedPrice / 100)) : "—";
      const article = String(o.article ?? o.vendorCode ?? "—").slice(0, 12);
      const status  = o.wbStatus === "waiting" ? "⏳" : o.wbStatus === "sorted_for_client" ? "📦" : "🔄";
      lines.push(`${pad(dateStr, 8)}  ${pad(article, 14)}  ${pad(price, 8)}  ${status}`);
    }
    lines.push(`</code>`);
    if (fbs.length > 15) lines.push(`\n<i>…ещё ${fbs.length - 15} заказов</i>`);
  }

  await editWidget(ctx, lines.join("\n"), Markup.inlineKeyboard([
    [Markup.button.callback("◀️ Назад", CB.hubWildberries), Markup.button.callback("🔄 Обновить", CB.wbFbs)],
  ]));
}

// ── Products ─────────────────────────────────────────────────────────────────

export async function showWbProducts(ctx: Context): Promise<void> {
  const products = await getProducts();
  const buttons: any[] = [];

  let lines: string[] = [];
  lines.push(`🏷️ <b>МОИ ТОВАРЫ</b>`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push("");

  if (!products) {
    lines.push(`⚠️ <b>Ошибка загрузки товаров.</b>\nПроверьте WB_API_TOKEN.`);
  } else if (products.length === 0) {
    lines.push(`У вас пока нет активных карточек.`);
  } else {
    for (const p of products) {
      const priceStr = p.price
        ? `💰 <b>${p.discountedPrice} ₽</b>` + (p.price !== p.discountedPrice ? ` (<s>${p.price}</s>)` : "")
        : `💰 <i>не указана</i>`;
      lines.push(`🔸 <b>${p.title || p.vendorCode}</b>\n   <code>${p.vendorCode}</code>  ${priceStr}`);
      lines.push("");
      buttons.push([Markup.button.callback(`✏️ Цена: ${p.vendorCode}`, CB.wbEditPrice(p.nmID))]);
    }
    lines.push(`<i>Нажмите кнопку ниже для изменения цены.</i>`);
  }

  buttons.push([Markup.button.callback("⬅️ Назад", CB.hubWildberries)]);
  await editWidget(ctx, lines.join("\n"), Markup.inlineKeyboard(buttons));
  await ctx.answerCbQuery();
}

// ── Price editing ────────────────────────────────────────────────────────────

export async function enterPriceInput(ctx: Context, nmID: number): Promise<void> {
  pendingPriceInput.set(ctx.from!.id, { nmID });
  await editWidget(
    ctx,
    `✏️ <b>ИЗМЕНЕНИЕ ЦЕНЫ</b>\n━━━━━━━━━━━━━━━━\n\n` +
    `Введите <b>новую базовую цену</b> для товара <code>${nmID}</code>.\n\n` +
    `⚠️ <i>Скидка останется прежней, итоговая цена пересчитается на WB.</i>`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Отмена", CB.wbProducts)]])
  );
  await ctx.answerCbQuery();
}

export async function handlePriceInput(ctx: Context, text: string): Promise<boolean> {
  const state = pendingPriceInput.get(ctx.from!.id);
  if (!state) return false;
  pendingPriceInput.delete(ctx.from!.id);

  const price = parseInt(text.trim());
  if (isNaN(price) || price <= 0) {
    await ctx.reply("❌ Некорректная цена. Введите положительное число.");
    return true;
  }

  const ok = await updatePrice(state.nmID, price);
  if (ok) {
    await ctx.reply(
      `✅ Базовая цена для <code>${state.nmID}</code> изменена на <b>${rub(price)}</b>.\nОбновление на WB — до 15 минут.`,
      { parse_mode: "HTML" }
    );
    await showWbProducts(ctx);
  } else {
    await ctx.reply("❌ Ошибка обновления цены. Проверьте логи или токен.");
  }
  return true;
}

// ── Add codes — denomination picker ──────────────────────────────────────────

export async function showAddCodesDenom(ctx: Context): Promise<void> {
  await editWidget(
    ctx,
    `➕ <b>ДОБАВЛЕНИЕ КОДОВ</b>\n━━━━━━━━━━━━━━━━\n\nВыбери номинал:`,
    Markup.inlineKeyboard([
      [Markup.button.callback("100 R$",  CB.wbAddDenom(100)),  Markup.button.callback("200 R$",  CB.wbAddDenom(200))],
      [Markup.button.callback("500 R$",  CB.wbAddDenom(500)),  Markup.button.callback("1000 R$", CB.wbAddDenom(1000))],
      [Markup.button.callback("⬅️ Назад", CB.hubWildberries)],
    ])
  );
  await ctx.answerCbQuery();
}

export async function enterCodesInput(ctx: Context, denomination: number): Promise<void> {
  pendingCodesInput.set(ctx.from!.id, { denomination });
  await editWidget(
    ctx,
    `➕ <b>ДОБАВЛЕНИЕ КОДОВ (${denomination} R$)</b>\n━━━━━━━━━━━━━━━━\n\n` +
    `Отправь коды — каждый на новой строке:\n\n<code>ABC123\nDEF456\nGHI789</code>\n\n<i>Ожидаю ввод…</i>`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Отмена", CB.hubWildberries)]])
  );
  await ctx.answerCbQuery();
}

export async function handleCodesInput(ctx: Context, text: string): Promise<boolean> {
  const state = pendingCodesInput.get(ctx.from!.id);
  if (!state) return false;
  pendingCodesInput.delete(ctx.from!.id);

  const lines = text
    .split(/[\n,;]+/)
    .map(l => l.trim().toUpperCase())
    .filter(l => l.length >= 3 && l.length <= 30);

  if (lines.length === 0) {
    await ctx.reply("❌ Не удалось распознать коды. Каждый код — на отдельной строке.");
    return true;
  }

  const existing = await (db as any).wbCode.findMany({
    where: { code: { in: lines } },
    select: { code: true },
  });
  const existingSet = new Set(existing.map((e: any) => e.code));
  const newCodes    = lines.filter(c => !existingSet.has(c));
  const dupeCount   = lines.length - newCodes.length;

  if (newCodes.length === 0) {
    await ctx.reply(`⚠️ Все ${lines.length} кодов уже существуют в базе.`);
    return true;
  }

  await (db as any).wbCode.createMany({
    data: newCodes.map(code => ({ code, denomination: state.denomination })),
    skipDuplicates: true,
  });

  let msg = `✅ Добавлено: <b>${newCodes.length}</b> кодов (${state.denomination} R$)`;
  if (dupeCount > 0) msg += `\n⚠️ Пропущено дубликатов: ${dupeCount}`;

  await ctx.reply(msg, { parse_mode: "HTML" });
  return true;
}

// ── Analytics (activation bar chart) ─────────────────────────────────────────

export async function showAnalytics(ctx: Context): Promise<void> {
  await editWidget(ctx, `📊 <b>ВЫБЕРИТЕ ПЕРИОД</b>\n━━━━━━━━━━━━━━━━`, Markup.inlineKeyboard([
    [Markup.button.callback("Вчера",  CB.wbAnalyticsPeriod("yesterday"))],
    [Markup.button.callback("7 дней", CB.wbAnalyticsPeriod("week"))],
    [Markup.button.callback("Месяц",  CB.wbAnalyticsPeriod("month"))],
    [Markup.button.callback("⬅️ Назад", CB.hubWildberries)],
  ]));
  await ctx.answerCbQuery();
}

export async function showAnalyticsForPeriod(ctx: Context, period: string): Promise<void> {
  const now  = new Date();
  const days = period === "yesterday" ? 1 : period === "month" ? 30 : 7;
  const rows: { label: string; count: number }[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const dayEnd   = new Date(dayStart.getTime() + 864e5);
    const count = await (db as any).wbCode.count({
      where: { isUsed: true, usedAt: { gte: dayStart, lt: dayEnd } },
    });
    rows.push({
      label: dayStart.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
      count,
    });
  }

  const maxCount = Math.max(...rows.map(r => r.count), 1);
  const chart = rows.map(r => {
    const barLen = Math.round((r.count / maxCount) * 10);
    return `${r.label}  ${"█".repeat(barLen)}${"░".repeat(10 - barLen)}  ${r.count}`;
  }).join("\n");

  const periodStr = period === "yesterday" ? "ВЧЕРА" : period === "month" ? "30 ДНЕЙ" : "7 ДНЕЙ";
  await editWidget(
    ctx,
    `📊 <b>АКТИВАЦИИ КОДОВ (${periodStr})</b>\n━━━━━━━━━━━━━━━━\n\n<code>${chart}</code>`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Назад", CB.wbAnalytics)]])
  );
  await ctx.answerCbQuery();
}

// ── Recent Orders (legacy) ───────────────────────────────────────────────────

export async function showRecentOrders(ctx: Context): Promise<void> {
  await showFbsHub(ctx);
}

// ── Download unused codes ────────────────────────────────────────────────────

export async function downloadUnusedCodes(ctx: Context): Promise<void> {
  const codes = await (db as any).wbCode.findMany({
    where: { isUsed: false },
    orderBy: [{ denomination: "asc" }, { createdAt: "asc" }],
    select: { code: true, denomination: true },
  });

  if (codes.length === 0) {
    await ctx.answerCbQuery("Нет неиспользованных кодов");
    return;
  }

  let text = "";
  let currentDenom = 0;
  for (const c of codes) {
    if (c.denomination !== currentDenom) {
      currentDenom = c.denomination;
      text += `\n--- ${currentDenom} R$ ---\n`;
    }
    text += `${c.code}\n`;
  }

  await ctx.reply(
    `📥 <b>Неиспользованные коды (${codes.length}):</b>\n<code>${text.trim()}</code>`,
    { parse_mode: "HTML" }
  );
  await ctx.answerCbQuery();
}
