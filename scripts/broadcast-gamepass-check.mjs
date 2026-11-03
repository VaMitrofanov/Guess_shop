#!/usr/bin/env node
/**
 * One-time broadcast: "check your gamepass / contact support" reminder.
 *
 * Posts to TG channel + VK wall, then DMs every user with an unfinished
 * WB order (gamepass-stage statuses only — payment-stage direct orders are
 * excluded because the gamepass message doesn't apply to them).
 *
 * One message per user: TG preferred if tgId present, else VK — so a
 * dual-linked user is not messaged twice.
 *
 * Usage:
 *   node scripts/broadcast-gamepass-check.mjs --dry-run   # preview audience, no sends
 *   node scripts/broadcast-gamepass-check.mjs             # LIVE
 *
 * Env: DATABASE_URL, TG_TOKEN, VK_TOKEN, TG_CHANNEL_ID, VK_GROUP_ID
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const DRY_RUN = process.argv.includes("--dry-run");
const { DATABASE_URL, TG_TOKEN, VK_TOKEN, TG_CHANNEL_ID, VK_GROUP_ID } = process.env;
if (!DATABASE_URL || !TG_TOKEN) throw new Error("DATABASE_URL and TG_TOKEN required");

// Gamepass-stage statuses only (no COMPLETED, no payment-stage direct orders).
const STATUSES = ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS"];

// ── Message texts ──────────────────────────────────────────────────────────

const TG_TEXT = `⚠️ <b>Проверь свой геймпасс — без этого робуксы не придут</b>

Если ты активировал код с Wildberries-карты, но робуксы до сих пор не пришли — проверь настройки геймпасса. Пока он настроен неправильно, мы <b>не сможем</b> его выкупить.

✅ <b>Проверь по пунктам:</b>
1️⃣ Геймпасс <b>создан</b> (Monetization → Passes)
2️⃣ <b>Item for sale</b> — включён (вкладка Sales)
3️⃣ <b>Цена точная</b> — ровно та, что показал бот
4️⃣ <b>Managed pricing — ОТКЛЮЧЁН</b> (вкладка Sales, переключатель ниже цены)

❗️ Чаще всего проблема именно в <b>Managed pricing</b> — он автоматически меняет цену геймпасса и выкуп становится невозможен.

📖 Инструкция с картинками: https://robloxbank.ru/guide?source=wb

Всё проверил, а робуксов нет? Напиши в поддержку — разберёмся:
💬 @RobloxBank_PA

Как только геймпасс настроен правильно — робуксы прилетят быстро 💙`;

const VK_TEXT = `⚠️ Проверь свой геймпасс — без этого робуксы не придут

Если ты активировал код с Wildberries-карты, но робуксы до сих пор не пришли — проверь настройки геймпасса. Пока он настроен неправильно, мы не сможем его выкупить.

✅ Проверь по пунктам:
1️⃣ Геймпасс создан (Monetization → Passes)
2️⃣ Item for sale — включён (вкладка Sales)
3️⃣ Цена точная — ровно та, что показал бот
4️⃣ Managed pricing — ОТКЛЮЧЁН (вкладка Sales, переключатель ниже цены)

❗️ Чаще всего проблема именно в Managed pricing — он автоматически меняет цену геймпасса и выкуп становится невозможен.

📖 Инструкция с картинками: https://robloxbank.ru/guide?source=wb

Всё проверил, а робуксов нет? Напиши в поддержку — разберёмся:
💬 ВК: vk.me/club237309399
💬 Telegram: t.me/RobloxBank_PA

Как только геймпасс настроен правильно — робуксы прилетят быстро 💙`;

// ── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tgSendText(chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  return res.json();
}

async function vkCall(method, params) {
  const body = new URLSearchParams({ access_token: VK_TOKEN, v: "5.131", ...params });
  const res = await fetch(`https://api.vk.com/method/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return res.json();
}

async function getAudience(pool) {
  const { rows } = await pool.query(
    `SELECT DISTINCT u.id, u."tgId", u."vkId"
     FROM "WbOrder" o JOIN "User" u ON u.id = o."userId"
     WHERE o.status = ANY($1) AND o."isTest" = false`,
    [STATUSES]
  );
  // One channel per user: TG preferred, else VK.
  const tg = [], vk = [];
  for (const u of rows) {
    if (u.tgId) tg.push(u.tgId);
    else if (u.vkId) vk.push(u.vkId);
  }
  return { tg, vk, total: rows.length };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  console.log(DRY_RUN ? "=== DRY RUN (ничего не отправляется) ===" : "=== LIVE BROADCAST ===");
  console.log("Статусы аудитории:", STATUSES.join(", "));

  const { tg, vk, total } = await getAudience(pool);
  console.log(`Аудитория ЛС: ${total} юзеров → TG: ${tg.length}, VK: ${vk.length}`);

  if (DRY_RUN) {
    console.log("TG recipients:", tg);
    console.log("VK recipients:", vk);
    await pool.end();
    return;
  }

  // 1. TG channel post
  if (TG_CHANNEL_ID) {
    const r = await tgSendText(TG_CHANNEL_ID, TG_TEXT);
    console.log(r.ok ? `📢 TG-канал: опубликовано (msg ${r.result.message_id})` : `❌ TG-канал: ${JSON.stringify(r)}`);
  }

  // 2. VK wall post
  if (VK_TOKEN && VK_GROUP_ID) {
    const r = await vkCall("wall.post", { owner_id: `-${VK_GROUP_ID}`, from_group: "1", message: VK_TEXT });
    console.log(r.response ? `📢 VK-стена: опубликовано (post ${r.response.post_id})` : `❌ VK-стена: ${JSON.stringify(r)}`);
  }

  // 3. TG DMs
  let tgOk = 0, tgFail = 0;
  for (const id of tg) {
    try {
      const r = await tgSendText(id, TG_TEXT);
      if (r.ok) tgOk++; else { tgFail++; console.warn(`  ❌ TG ${id}: ${r.description}`); }
    } catch (e) { tgFail++; console.warn(`  ❌ TG ${id}: ${e.message}`); }
    await sleep(50);
  }
  console.log(`📨 TG ЛС: ${tgOk} ок, ${tgFail} ошибок`);

  // 4. VK DMs
  let vkOk = 0, vkFail = 0;
  if (VK_TOKEN) {
    for (const id of vk) {
      try {
        const r = await vkCall("messages.send", {
          user_id: id, message: VK_TEXT,
          random_id: String(Date.now() + Math.floor(Math.random() * 100000)),
        });
        if (r.response) vkOk++; else { vkFail++; console.warn(`  ❌ VK ${id}: ${JSON.stringify(r.error)}`); }
      } catch (e) { vkFail++; console.warn(`  ❌ VK ${id}: ${e.message}`); }
      await sleep(55);
    }
  }
  console.log(`📨 VK ЛС: ${vkOk} ок, ${vkFail} ошибок`);

  await pool.end();
  console.log("\n✅ Рассылка завершена.");
}

main().catch((e) => { console.error(e); process.exit(1); });
