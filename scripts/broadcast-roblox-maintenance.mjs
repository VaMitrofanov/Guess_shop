#!/usr/bin/env node
/**
 * One-time Roblox maintenance announcement.
 * Publishes to the TG channel and VK community, then sends status-specific
 * notices to users with unfinished real WbOrders.
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

const TG_TEXT = `✅ <b>Выкуп снова работает в штатном режиме!</b>

Мы устранили проблему, связанную с обновлением Roblox. Покупка геймпассов и выкуп робуксов снова доступны.

Если у вас остался незавершённый заказ — не переживайте, мы обязательно его обработаем. Робуксы будут зачислены на указанный аккаунт.

Спасибо за терпение и понимание! 🙏`;
const AWAITING_TEXT = `⚠️ <b>По твоему заказу выкуп ещё не завершён</b>

Мы всё починили, и выкуп снова работает в штатном режиме. Но для твоего заказа мы пока ждём ссылку на геймпасс.

Пришли ссылку на геймпасс в этот чат. Если не получается создать или отправить геймпасс — напиши нам, в чём проблема, и мы поможем разобраться.

Пожалуйста, не переживай: заказ не потерян, мы доведём его до конца.`;
const VK_TEXT = TG_TEXT.replaceAll(/<[^>]+>/g, "");
const VK_AWAITING_TEXT = AWAITING_TEXT.replaceAll(/<[^>]+>/g, "");

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
    SELECT u."tgId", u."vkId", array_agg(DISTINCT o.status) AS statuses
    FROM "WbOrder" o
    JOIN "User" u ON u.id = o."userId"
    WHERE o.status NOT IN ('COMPLETED', 'REJECTED')
      AND o."isTest" = false
    GROUP BY u."tgId", u."vkId"
  `);
  const awaiting = rows.filter((row) => row.statuses.includes("AWAITING_GAMEPASS"));
  const normal = rows.filter((row) => !row.statuses.includes("AWAITING_GAMEPASS"));
  return { rows, awaiting, normal };
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  const audience = await getAudience(pool);
  console.log(`${DRY_RUN ? "DRY RUN: " : ""}audience: normal ${audience.normal.length}, awaiting gamepass ${audience.awaiting.length}`);
  console.log(`contacts: TG ${audience.rows.filter((row) => row.tgId).length}, VK ${audience.rows.filter((row) => row.vkId).length}`);
  console.log(`by platform: normal TG ${audience.normal.filter((row) => row.tgId).length}, VK ${audience.normal.filter((row) => row.vkId).length}; awaiting TG ${audience.awaiting.filter((row) => row.tgId).length}, VK ${audience.awaiting.filter((row) => row.vkId).length}`);
  if (DRY_RUN) return pool.end();

  const result = {
    tgChannel: false,
    vkWall: false,
    tgSent: 0,
    tgFailed: 0,
    tgAwaitingSent: 0,
    tgAwaitingFailed: 0,
    vkSent: 0,
    vkFailed: 0,
    vkAwaitingSent: 0,
    vkAwaitingFailed: 0,
  };

  if (TG_CHANNEL_ID) {
    const post = await tgCall("sendMessage", {
      chat_id: TG_CHANNEL_ID,
      text: TG_TEXT,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    if (!post.ok) throw new Error(`TG channel post failed: ${post.description ?? JSON.stringify(post)}`);
    result.tgChannel = true;
    for (const user of audience.normal.filter((row) => row.tgId)) {
      const sent = await tgCall("forwardMessage", {
        chat_id: user.tgId,
        from_chat_id: TG_CHANNEL_ID,
        message_id: post.result.message_id,
      });
      if (sent.ok) result.tgSent++;
      else result.tgFailed++;
      await sleep(55);
    }
    for (const user of audience.awaiting.filter((row) => row.tgId)) {
      const sent = await tgCall("sendMessage", { chat_id: user.tgId, text: AWAITING_TEXT, parse_mode: "HTML" });
      if (sent.ok) result.tgAwaitingSent++;
      else result.tgAwaitingFailed++;
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
    for (const user of audience.normal.filter((row) => row.vkId)) {
      const sent = await vkCall("messages.send", {
        user_id: user.vkId,
        random_id: String(Date.now() + Math.floor(Math.random() * 10000)),
        message: VK_TEXT,
      });
      if (sent.error) result.vkFailed++;
      else result.vkSent++;
      await sleep(55);
    }
    for (const user of audience.awaiting.filter((row) => row.vkId)) {
      const sent = await vkCall("messages.send", {
        user_id: user.vkId,
        random_id: String(Date.now() + Math.floor(Math.random() * 10000)),
        message: VK_AWAITING_TEXT,
      });
      if (sent.error) result.vkAwaitingFailed++;
      else result.vkAwaitingSent++;
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
