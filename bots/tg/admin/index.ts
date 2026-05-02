/**
 * Admin dashboard — barrel export and handler registration.
 *
 * Wires up all 4 hubs (Orders, Stats, WB, System) to the Telegraf bot.
 * Reply Keyboard button presses → hub main widgets.
 * Inline callback_data → hub sub-views via editMessageText.
 */

import type { Telegraf, Context } from "telegraf";
import { Markup } from "telegraf";
import { ADMIN_IDS, CB } from "../../shared/admin";
import { buildAdminKeyboard, updateMainMenu } from "./menu";
import {
  showOrdersHub, showActiveOrders, showOrderCard, enterSearchMode,
  showHistory24h, showBatchView, confirmBatchFulfill, takeOrderInWork,
  handleSearchQuery,
} from "./hub-orders";
import { showStatsHub, refreshStats, enterRateInput, handleRateInput } from "./hub-stats";
import { showRatesHub, refreshRates, showRatesAnalytics } from "./hub-rates";
import {
  showWildberriesHub, refreshWb, showAddCodesDenom, enterCodesInput,
  showAnalytics, showAnalyticsForPeriod, downloadUnusedCodes, handleCodesInput, showWbProducts,
  enterPriceInput, handlePriceInput, showRecentOrders,
} from "./hub-wildberries";
import {
  showSystemHub, showLogs, showRestartConfirm, handleRestartConfirm,
  initLogCapture,
} from "./hub-system";
import {
  pendingAdminSearch, pendingCodesInput, pendingRateInput, pendingPriceInput,
} from "../session";

// Re-export for external use
export { updateMainMenu, buildAdminKeyboard };

/**
 * Register all admin dashboard handlers on the bot.
 * Call this from bot.ts BEFORE registerCallbacks (order matters).
 */
export function registerAdminHubs(bot: Telegraf): void {
  // Start log capture for the System hub
  initLogCapture();

  /**
   * Wrapper for admin menu commands (Zero-Spam UI).
   * Deletes the user's menu text message and invokes the handler.
   * The handler uses sendOrEditWidget to update the bot's last message.
   */
  const handleAdminMenu = async (ctx: Context, handler: (ctx: Context) => Promise<void>) => {
    if (!ADMIN_IDS.includes(String(ctx.from?.id))) return;

    if (ctx.message?.message_id) {
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch {
        // Silently ignore "Bad Request: message to delete not found" or >48h
      }
    }

    await handler(ctx);
  };

  // ── Reply Keyboard handlers (hears) ──────────────────────────────────────
  // Dynamic button text includes counters, so we match with regex.

  bot.hears(/^📦 Заказы/, (ctx) => handleAdminMenu(ctx, showOrdersHub));
  bot.hears("📈 Статистика", (ctx) => handleAdminMenu(ctx, showStatsHub));
  bot.hears(/^🟣 Wildberries/, (ctx) => handleAdminMenu(ctx, showWildberriesHub));
  bot.hears("🛠 Состояние", (ctx) => handleAdminMenu(ctx, showSystemHub));
  bot.hears("💱 Курс", (ctx) => handleAdminMenu(ctx, showRatesHub));

  // ── Text input interceptors for admin modes ──────────────────────────────
  // These run BEFORE the main text handler in handlers.ts.
  // Order of registration matters — these are registered first.

  bot.on("text", async (ctx, next) => {
    if (!ADMIN_IDS.includes(String(ctx.from.id))) return next();
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return next();

    // 1. Search input
    if (pendingAdminSearch.has(ctx.from.id)) {
      await handleSearchQuery(ctx, text);
      return;
    }

    // 2. Codes input
    if (pendingCodesInput.has(ctx.from.id)) {
      const handled = await handleCodesInput(ctx, text);
      if (handled) return;
    }

    // 3. Rate input
    if (pendingRateInput.has(ctx.from.id)) {
      const handled = await handleRateInput(ctx, text);
      if (handled) return;
    }

    // 4. Price input
    if (pendingPriceInput.has(ctx.from.id)) {
      const handled = await handlePriceInput(ctx, text);
      if (handled) return;
    }

    return next();
  });
}

/**
 * Route admin inline callback queries to the appropriate hub handler.
 * Called from the main callback_query handler in handlers.ts.
 * Returns true if the callback was handled.
 */
export async function routeAdminCallback(
  bot: Telegraf,
  ctx: any,
  data: string,
  adminId: string
): Promise<boolean> {
  if (!ADMIN_IDS.includes(adminId)) return false;

  // ── Orders hub ─────────────────────────────────────────────────────────
  if (data === CB.ordersActive) {
    await showActiveOrders(ctx);
    await ctx.answerCbQuery();
    return true;
  }
  if (data === CB.ordersSearch) {
    await enterSearchMode(ctx);
    return true;
  }
  if (data === CB.ordersHistory) {
    await showHistory24h(ctx);
    await ctx.answerCbQuery();
    return true;
  }
  if (data === CB.ordersBatch) {
    await showBatchView(ctx);
    await ctx.answerCbQuery();
    return true;
  }
  if (data === CB.ordersBatchConfirm) {
    await confirmBatchFulfill(bot, ctx);
    return true;
  }
  if (data === CB.ordersBack) {
    await showOrdersHub(ctx);
    await ctx.answerCbQuery();
    return true;
  }
  if (data.startsWith("ord_work:")) {
    const orderId = data.split(":")[1];
    await takeOrderInWork(bot, ctx, orderId);
    return true;
  }
  if (data.startsWith("admin_view:")) {
    const orderId = data.split(":")[1];
    await showOrderCard(ctx, orderId);
    await ctx.answerCbQuery();
    return true;
  }
  // ord_ct: contact links are now URL buttons — no callback handler needed.

  // ── Stats hub ──────────────────────────────────────────────────────────
  if (data === CB.hubStats) {
    await showStatsHub(ctx);
    await ctx.answerCbQuery();
    return true;
  }
  if (data === CB.statsChangeRate) {
    await enterRateInput(ctx);
    return true;
  }
  if (data === CB.statsRefresh) {
    await refreshStats(ctx);
    await ctx.answerCbQuery("Обновлено");
    return true;
  }

  // ── Rates hub ──────────────────────────────────────────────────────────
  if (data === CB.hubRates) {
    await showRatesHub(ctx);
    await ctx.answerCbQuery();
    return true;
  }
  if (data === CB.ratesRefresh) {
    await refreshRates(ctx);
    await ctx.answerCbQuery("Обновлено");
    return true;
  }
  if (data === CB.ratesAnalytics) {
    await showRatesAnalytics(ctx);
    await ctx.answerCbQuery();
    return true;
  }

  // ── WB hub ─────────────────────────────────────────────────────────────
  if (data === CB.hubWildberries) {
    await showWildberriesHub(ctx);
    await ctx.answerCbQuery();
    return true;
  }
  if (data === CB.wbAddCodes) {
    await showAddCodesDenom(ctx);
    return true;
  }
  if (data.startsWith("wb_denom:")) {
    const denom = parseInt(data.split(":")[1]);
    await enterCodesInput(ctx, denom);
    return true;
  }
  if (data === CB.wbAnalytics) {
    await showAnalytics(ctx);
    return true;
  }
  if (data.startsWith("wb_stat_p:")) {
    const period = data.split(":")[1];
    await showAnalyticsForPeriod(ctx, period);
    return true;
  }
  if (data === CB.wbProducts) {
    await showWbProducts(ctx);
    return true;
  }
  if (data === CB.wbRecentOrders) {
    await showRecentOrders(ctx);
    return true;
  }
  if (data === CB.wbDownload) {
    await downloadUnusedCodes(ctx);
    return true;
  }
  if (data.startsWith("wb_edit_p:")) {
    const nmID = parseInt(data.split(":")[1]);
    await enterPriceInput(ctx, nmID);
    return true;
  }
  if (data === CB.wbRefresh) {
    await refreshWb(ctx);
    await ctx.answerCbQuery("Обновлено");
    return true;
  }

  // ── System hub ─────────────────────────────────────────────────────────
  if (data === CB.hubSystem) {
    await showSystemHub(ctx);
    await ctx.answerCbQuery();
    return true;
  }
  if (data.startsWith("sys_log:")) {
    const name = data.split(":")[1];
    await showLogs(ctx, name);
    return true;
  }
  if (data.startsWith("sys_rst:")) {
    const name = data.split(":")[1];
    await showRestartConfirm(ctx, name);
    return true;
  }
  if (data.startsWith("sys_crst:")) {
    const name = data.split(":")[1];
    await handleRestartConfirm(ctx, name);
    return true;
  }
  if (data === CB.sysRefresh) {
    await showSystemHub(ctx);
    await ctx.answerCbQuery("Обновлено");
    return true;
  }

  return false;
}
