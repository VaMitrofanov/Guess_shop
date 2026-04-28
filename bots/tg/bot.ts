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

import {
  registerStart,
  registerStatus,
  registerText,
  registerPhoto,
  registerCallbacks,
  registerAdmin,
} from "./handlers";

const token = process.env.TG_TOKEN;
if (!token) throw new Error("[TG] TG_TOKEN is not set");

export const bot = new Telegraf(token);

// Register all handlers (order matters: commands → callbacks → text → photo)
registerStart(bot);
registerStatus(bot);
registerAdmin(bot);
registerCallbacks(bot);
registerText(bot);
registerPhoto(bot);

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
  bot.launch().then(() => {
    console.log("[TG] Bot started ✅");
    console.log(
      `[TG] Admin IDs: ${process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "(none)"}`
    );
  }).catch((err: Error) => {
    console.error("[TG] Failed to start:", err);
    process.exit(1);
  });
}

process.once("SIGINT",  () => { console.log("[TG] Stopping…"); bot.stop("SIGINT");  });
process.once("SIGTERM", () => { console.log("[TG] Stopping…"); bot.stop("SIGTERM"); });
