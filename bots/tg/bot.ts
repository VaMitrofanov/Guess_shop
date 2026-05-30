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
 *   TG_CHANNEL_ID       — channel to gate subscription check
 *   VK_TOKEN            — community token for cross-platform VK notifications
 *   VALIDATOR_KEY       — shared secret; starts the bridge server when set
 *   VALIDATOR_PORT      — bridge server port (default: 3000)
 *   DISABLE_POLLING     — set to "true" to skip bot.launch() (bridge-only mode).
 *                         Use on the Russia instance to avoid a 409 Conflict when
 *                         Singapore is already polling the same bot token.
 *   VALIDATOR_SOURCE_URL — URL of the Singapore bridge; when set, Roblox calls
 *                          are routed through it instead of hitting Roblox directly.
 */

import "dotenv/config";
import { Telegraf } from "telegraf";
import { startBridgeServer } from "../shared/bridge";

console.log("🚀 DEPLOY_VERSION: 4.0 - LOYALTY_HARD_SYNC");

import {
  registerStart,
  registerStatus,
  registerText,
  registerPhoto,
  registerCallbacks,
  registerAdmin,
  registerChatMember,
} from "./handlers";
import { registerAdminHubs, setupMenuButton } from "./admin";
import { startReviewReminderCron } from "./crons";

const token = process.env.TG_TOKEN;
if (!token) throw new Error("[TG] TG_TOKEN is not set");

export const bot = new Telegraf(token);

// Register all handlers (order matters: admin hubs → commands → callbacks → text → photo)
// Admin hubs must be registered FIRST so their text interceptors (search, codes, rate)
// fire before the generic text handler in handlers.ts.
registerAdminHubs(bot);
registerStart(bot);
registerStatus(bot);
registerAdmin(bot);
registerCallbacks(bot);
registerText(bot);
registerPhoto(bot);
registerChatMember(bot); // must be after other handlers; fires when user joins TG_CHANNEL_ID

// ── Bridge server ────────────────────────────────────────────────────────────
// Always start when VALIDATOR_KEY is set — works as provider (Singapore) or as
// a passthrough-free backup (Russia with DISABLE_POLLING).
if (process.env.VALIDATOR_KEY) {
  startBridgeServer();
} else {
  console.log(
    "[TG] VALIDATOR_KEY not set — bridge server not started. " +
    "Add VALIDATOR_KEY in Coolify to enable the validation bridge."
  );
}

// ── Polling ──────────────────────────────────────────────────────────────────
const disablePolling = process.env.DISABLE_POLLING === "true";

if (disablePolling) {
  // Bridge-only mode: the Singapore instance is already handling Telegram updates.
  // Running bot.launch() here would cause a 409 Conflict (two instances polling).
  console.log(
    "[TG] DISABLE_POLLING=true — bot.launch() skipped. " +
    "This instance serves as a validation bridge only."
  );
} else {
  bot.launch({
    allowedUpdates: ["message", "callback_query", "my_chat_member", "chat_member"],
  }).catch((err: Error) => {
    console.error("[TG] Failed to start:", err);
    process.exit(1);
  });
  // Set Menu Button (left of input) for each admin — opens TWA dashboard directly
  setupMenuButton(bot).catch((err: Error) => console.error("[TG] setChatMenuButton failed:", err));
  startReviewReminderCron(bot);
  console.log("[TG] Bot started ✅ (polling)");
  const adminIds = process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "";
  if (!adminIds.trim()) {
    console.error(
      "[TG] *** SECURITY: ADMIN_IDS (and TG_CHAT_ID) are not set. " +
      "Any Telegram user can trigger admin callbacks on order cards. " +
      "Set ADMIN_IDS in Coolify env vars immediately. ***"
    );
  } else {
    console.log(`[TG] Admin IDs: ${adminIds}`);
  }
}

process.once("SIGINT",  () => { console.log("[TG] Stopping…"); bot.stop("SIGINT");  });
process.once("SIGTERM", () => { console.log("[TG] Stopping…"); bot.stop("SIGTERM"); });
