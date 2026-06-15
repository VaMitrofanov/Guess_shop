/**
 * Admin dashboard — background monitors + Menu Button setup.
 *
 * As of sprint 2 the admin UI lives entirely in the TWA, opened via the single
 * "🚀 Launch Dashboard" reply button / Menu Button; the bot chat is a
 * notifications channel. The old reply-keyboard hubs, their text-input
 * interceptors and the inline callback router (`routeAdminCallback`) have been
 * removed — they were dead since Phase A turned the keyboard into one Launch
 * button (nothing renders a hub-entry button, so no hub message, input mode or
 * hub callback was ever reachable). The hub view functions still live in
 * `hub-*.ts` but are now orphaned; only the background monitors below are wired.
 */

import type { Telegraf } from "telegraf";
import { ADMIN_IDS } from "../../shared/admin";
import { buildAdminKeyboard } from "./menu";
import { startWbMonitor } from "./hub-wildberries";
import { initLogCapture, startServerMonitor } from "./hub-system";

// Re-export for external use
export { buildAdminKeyboard };

/**
 * Register admin background monitors on the bot.
 * Call this from bot.ts BEFORE registerCallbacks (order matters).
 */
export function registerAdminHubs(bot: Telegraf): void {
  // Capture logs for the System screen (TWA reads them via /api/twa/system).
  initLogCapture();

  // WB background monitor — pushes stock/price alerts every 15 min.
  startWbMonitor(bot);

  // Server monitor — checks Hetzner/VDSina every 30 min.
  startServerMonitor();
}

/**
 * Set the Menu Button (left of the input field) to open the TWA dashboard.
 * Called once at bot startup for every admin chat.
 */
export async function setupMenuButton(bot: import("telegraf").Telegraf): Promise<void> {
  const base = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://robloxbank.ru"}/twa`;
  await Promise.allSettled(
    ADMIN_IDS.map(id =>
      bot.telegram.setChatMenuButton({
        chatId: Number(id),
        menuButton: { type: "web_app", text: "Dashboard", web_app: { url: `${base}?uid=${id}` } },
      })
    )
  );
}
