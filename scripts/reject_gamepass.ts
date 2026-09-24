/**
 * Reject a PENDING order whose gamepass failed admin verification.
 * Sets status back to AWAITING_GAMEPASS so the user can re-submit a new link.
 *
 * Usage:
 *   npx tsx scripts/reject_gamepass.ts <orderId> "<reason>"
 *
 * Example:
 *   npx tsx scripts/reject_gamepass.ts cmpksef2v00000ipaxymitcj2 "modified_after_creation"
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pkg from "pg";
// @ts-ignore
const { Pool } = pkg;

const orderId = process.argv[2];
const reason  = process.argv[3] ?? "gamepass_rejected";

if (!orderId) {
  console.error("Usage: npx tsx scripts/reject_gamepass.ts <orderId> \"<reason>\"");
  process.exit(1);
}

const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db      = new PrismaClient({ adapter } as any);

async function vkSend(userId: string, message: string): Promise<void> {
  const params = new URLSearchParams({
    user_id:      userId,
    message,
    random_id:    String(Date.now() + Math.floor(Math.random() * 1000)),
    access_token: process.env.VK_TOKEN ?? "",
    v:            "5.131",
  });
  const res = await fetch("https://api.vk.com/method/messages.send", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    params.toString(),
  });
  const json = await res.json() as any;
  if (json.error) throw new Error(`VK API error: ${JSON.stringify(json.error)}`);
  console.log(`✅ VK message sent (message_id=${json.response})`);
}

async function tgSend(chatId: string, text: string): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${process.env.TG_TOKEN}/sendMessage`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } }),
    }
  );
  const json = await res.json() as any;
  if (!json.ok) throw new Error(`TG error: ${JSON.stringify(json.description)}`);
  console.log(`✅ TG message sent (message_id=${json.result.message_id})`);
}

async function main() {
  const order = await (db as any).wbOrder.findUnique({
    where: { id: orderId },
    include: { user: true },
  });

  if (!order) {
    console.error(`❌ Order ${orderId} not found`);
    process.exit(1);
  }

  const user = order.user as any;
  console.log(`📦 Order: ${order.id}`);
  console.log(`   Status:   ${order.status}`);
  console.log(`   Amount:   ${order.amount} R$`);
  console.log(`   Gamepass: ${order.gamepassUrl}`);
  console.log(`   Platform: ${order.platform}`);
  console.log(`   TG ID:    ${user?.tgId ?? "—"}`);
  console.log(`   VK ID:    ${user?.vkId ?? "—"}`);

  if (!["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS"].includes(order.status)) {
    console.error(`❌ Order status is "${order.status}" — only PENDING/IN_PROGRESS/AWAITING_GAMEPASS can be reset`);
    process.exit(1);
  }

  // Reset order to AWAITING_GAMEPASS so user can re-submit a fresh gamepass link
  await (db as any).wbOrder.update({
    where: { id: orderId },
    data: {
      status:      "AWAITING_GAMEPASS",
      gamepassUrl: null,
    },
  });
  console.log(`\n✅ Order reset to AWAITING_GAMEPASS (gamepassUrl cleared)`);

  const expectedPrice = Math.ceil(order.amount / 0.7);
  const shortId       = orderId.slice(-5).toUpperCase();

  // Notify user
  const msg =
    `❌ Геймпасс по заказу #${shortId} не принят.\n\n` +
    `Причина: геймпасс был изменён после создания — кнопка «Купить» на нём временно недоступна.\n\n` +
    `Что делать:\n` +
    `1. Создай новый геймпасс с нуля\n` +
    `2. Установи цену ровно ${expectedPrice} R$\n` +
    `3. Пришли ссылку на него сюда\n\n` +
    `Старый геймпасс можно удалить.`;

  if (order.platform === "VK" && user?.vkId) {
    await vkSend(user.vkId, msg);
  } else if (order.platform === "TG" && user?.tgId) {
    await tgSend(user.tgId, msg);
  } else {
    console.warn("⚠️ No contact info — message NOT sent");
  }

  await pool.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
