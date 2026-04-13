/**
 * VK Community Bot — entry point.
 *
 * Start:
 *   npm run bot:vk           # production
 *   npm run bot:dev:vk       # hot-reload with tsx watch
 *
 * Required env vars:
 *   VK_TOKEN     — VK community access token (Messages permission)
 *   VK_GROUP_ID  — numeric VK group / community ID
 *   DATABASE_URL — PostgreSQL connection string
 *   TG_TOKEN     — Telegram bot token (for cross-platform admin cards)
 *   ADMIN_IDS / TG_CHAT_ID — Telegram admin chat IDs
 *
 * VK community setup:
 *   1. Enable "Messages" in community settings
 *   2. Create a community token with "messages" and "photos" permissions
 *   3. Set VK_TOKEN and VK_GROUP_ID in .env
 */

import "dotenv/config";
import { VK } from "vk-io";
import { handleMessage } from "./handlers";

const token   = process.env.VK_TOKEN;
const groupId = process.env.VK_GROUP_ID ? parseInt(process.env.VK_GROUP_ID) : undefined;

if (!token)   throw new Error("[VK] VK_TOKEN is not set");
if (!groupId) throw new Error("[VK] VK_GROUP_ID is not set");

export const vk = new VK({ token, apiVersion: "5.131" });

// Register message_new handler
vk.updates.on("message_new", async (ctx) => {
  console.log(">>> [VK DEBUG] Message Received! Context:", JSON.stringify(ctx));
  try {
    await handleMessage(ctx as any);
  } catch (err) {
    console.error("[VK] Unhandled error in message_new:", err);
  }
});

// Start long polling
vk.updates
  .startPolling()
  .then(() => {
    console.log(`[VK] Bot started ✅ (group ${groupId})`);
  })
  .catch((err: Error) => {
    console.error("[VK] Failed to start:", err);
    process.exit(1);
  });

process.once("SIGINT",  () => { console.log("[VK] Stopping…"); vk.updates.stop(); });
process.once("SIGTERM", () => { console.log("[VK] Stopping…"); vk.updates.stop(); });
