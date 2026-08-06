#!/usr/bin/env node
/**
 * One-time Roblox maintenance announcement.
 * Publishes to the TG channel and VK community, then sends the same notice
 * to users with unfinished real WbOrders.
 *
 * Usage: node scripts/broadcast-roblox-maintenance.mjs [--dry-run]
 */

import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const DRY_RUN = process.argv.includes("--dry-run");
const { DATABASE_URL, TG_TOKEN, TG_CHANNEL_ID, VK_TOKEN, VK_GROUP_ID } = process.env;
if (!DATABASE_URL || !TG_TOKEN) throw new Error("DATABASE_URL and TG_TOKEN required");

const TG_TEXT = `⚠️ <b>Временно недоступен выкуп</b>

Из-за очередного обновления Roblox геймпассы временно недоступны для покупки.

Проблема возникла на стороне Roblox — мы уже разбираемся в ситуации и максимально быстро выясняем, что необходимо сделать, чтобы вернуть доступ к покупке геймпассов.

Пожалуйста, не переживайте: ваши робуксы никуда не пропадут. В любом случае они будут зачислены на указанный аккаунт после восстановления работы выкупа.

Спасибо за понимание! Мы сообщим, как только выкуп снова станет доступен.`;
const VK_TEXT = TG_TEXT.replaceAll(/<[^>]+>/g, "");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tgApi = (method) => `https://api.telegram.org/bot${TG_TOKEN}/${method}`;

async function tgCall(method, body) {
  const response = await fetch(tgApi(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function vkCall(method, params) {
  const response = await fetch(`https://api.vk.com/method/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: VK_TOKEN ?? "", v: "5.131", ...params }),
  });
  return response.json();
}

async function getAudience(pool) {
  const { rows } = await pool.query(`
    SELECT DISTINCT u."tgId", u."vkId"
    FROM "WbOrder" o
    JOIN "User" u ON u.id = o."userId"
    WHERE o.status NOT IN ('COMPLETED', 'REJECTED')
      AND o."isTest" = false
  `);
  return {
    tg: rows.filter((row) => row.tgId).map((row) => row.tgId),
    vk: rows.filter((row) => row.vkId).map((row) => row.vkId),
  };
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  const audience = await getAudience(pool);
  console.log(`${DRY_RUN ? "DRY RUN: " : ""}audience: TG ${audience.tg.length}, VK ${audience.vk.length}`);
  if (DRY_RUN) return pool.end();

  const result = { tgChannel: false, vkWall: false, tgSent: 0, tgFailed: 0, vkSent: 0, vkFailed: 0 };

  if (TG_CHANNEL_ID) {
    const post = await tgCall("sendMessage", {
      chat_id: TG_CHANNEL_ID,
      text: TG_TEXT,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    if (!post.ok) throw new Error(`TG channel post failed: ${post.description ?? JSON.stringify(post)}`);
    result.tgChannel = true;
    for (const chatId of audience.tg) {
      const sent = await tgCall("forwardMessage", {
        chat_id: chatId,
        from_chat_id: TG_CHANNEL_ID,
        message_id: post.result.message_id,
      });
      if (sent.ok) result.tgSent++;
      else result.tgFailed++;
      await sleep(55);
    }
  }

  if (VK_TOKEN && VK_GROUP_ID) {
    const wall = await vkCall("wall.post", {
      owner_id: `-${VK_GROUP_ID}`,
      from_group: "1",
      message: VK_TEXT,
    });
    if (wall.error) throw new Error(`VK wall post failed: ${wall.error.error_msg ?? JSON.stringify(wall.error)}`);
    result.vkWall = true;
    for (const userId of audience.vk) {
      const sent = await vkCall("messages.send", {
        user_id: userId,
        random_id: String(Date.now() + Math.floor(Math.random() * 10000)),
        message: VK_TEXT,
      });
      if (sent.error) result.vkFailed++;
      else result.vkSent++;
      await sleep(55);
    }
  }

  console.log(JSON.stringify(result));
  await pool.end();
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
