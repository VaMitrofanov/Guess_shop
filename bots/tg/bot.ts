/**
 * Telegram Bot — entry point.
 *
 * Start:
 *   npm run bot:tg           # production
 *   npm run bot:dev:tg       # hot-reload with tsx watch
 *
 * Required env vars:
 *   TG_TOKEN         — Telegram bot token
 *   DATABASE_URL     — PostgreSQL connection string
 *   ADMIN_IDS / TG_CHAT_ID — comma-separated Telegram admin chat IDs
 *
 * Optional:
 *   TG_CHANNEL_ID    — channel to gate subscription check (@channel or -100...)
 *   VK_TOKEN         — community token for cross-platform VK notifications
 */

import "dotenv/config"; // loads .env from process.cwd() (project root)
import { Telegraf } from "telegraf";

import {
  registerStart,
  registerStatus,
  registerText,
  registerPhoto,
  registerCallbacks,
} from "./handlers";

const token = process.env.TG_TOKEN;
if (!token) throw new Error("[TG] TG_TOKEN is not set");

export const bot = new Telegraf(token);

// Register all handlers (order matters: commands → text → photo → callbacks)
registerStart(bot);
registerStatus(bot);
registerCallbacks(bot); // must be before generic text/photo to capture button presses
registerText(bot);
registerPhoto(bot);

// Graceful launch & shutdown
bot.launch().then(() => {
  console.log("[TG] Bot started ✅");
  console.log(`[TG] Admin IDs: ${process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "(none)"}`);
}).catch((err: Error) => {
  console.error("[TG] Failed to start:", err);
  process.exit(1);
});

process.once("SIGINT",  () => { console.log("[TG] Stopping…"); bot.stop("SIGINT");  });
process.once("SIGTERM", () => { console.log("[TG] Stopping…"); bot.stop("SIGTERM"); });
