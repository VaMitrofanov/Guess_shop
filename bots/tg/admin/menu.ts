/**
 * Dynamic Reply Keyboard and updateMainMenu for admin dashboard.
 *
 * The main menu is a 2×2 Reply Keyboard that shows live counters:
 *   📦 Заказы (N)     📈 Статистика
 *   🟣 Wildberries ●  🛠 Состояние
 *
 * updateMainMenu() is called on every state change (new order, fulfillment,
 * code exhaustion) to refresh counters for all admins.
 */

import { Markup, type Telegraf } from "telegraf";
import { db } from "../../shared/db";
import { ADMIN_IDS } from "../../shared/admin";

/** Threshold below which a denomination is considered "critically low". */
const LOW_STOCK_THRESHOLD = 5;

/**
 * Build the admin Reply Keyboard with live counters.
 */
export async function buildAdminKeyboard() {
  const pendingCount = await (db as any).wbOrder.count({
    where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
  });

  const codesLow = await checkCodesLow();
  const stockIndicator = codesLow ? "🔴" : "🟢";

  return Markup.keyboard([
    [`📦 Заказы (${pendingCount})`, "📈 Статистика"],
    [`🟣 Wildberries ${stockIndicator}`, "🛠 Состояние"],
    ["💱 Курс"],
  ]).resize();
}

/**
 * Check if any denomination has fewer than LOW_STOCK_THRESHOLD unused codes.
 */
async function checkCodesLow(): Promise<boolean> {
  const groups = await (db as any).wbCode.groupBy({
    by: ["denomination"],
    _count: { _all: true },
    where: { isUsed: false },
  });

  if (groups.length === 0) return true; // No codes at all

  return groups.some(
    (g: { _count: { _all: number } }) => g._count._all < LOW_STOCK_THRESHOLD
  );
}

/**
 * Refresh the Reply Keyboard for all admins.
 * Called after state-changing events (order created/fulfilled, codes added, etc.).
 *
 * Sends a minimal status line so the keyboard update isn't jarring.
 */
export async function updateMainMenu(bot: Telegraf): Promise<void> {
  const keyboard = await buildAdminKeyboard();

  // Use sendMessage with minimal text to push the updated keyboard.
  // Telegram requires a message body to update the Reply Keyboard.
  const pendingCount = await (db as any).wbOrder.count({
    where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
  });

  const statusLine = pendingCount > 0
    ? `📋 В очереди: ${pendingCount}`
    : "✅ Очередь пуста";

  await Promise.allSettled(
    ADMIN_IDS.map((id) =>
      bot.telegram.sendMessage(id, statusLine, keyboard)
    )
  );
}
