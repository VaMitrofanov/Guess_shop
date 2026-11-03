#!/usr/bin/env node
/**
 * One-off: manually credit the +100 R$ review bonus for given WB codes,
 * replicating the canonical `review_ok` handler (atomic + idempotent),
 * then notify each user from the bot (VK or TG) with a "buy direct" CTA.
 *
 * Usage: node scripts/credit-review-bonus.mjs <CODE> [<CODE> ...] [--dry-run]
 */
import pg from "pg";
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const DRY_RUN = process.argv.includes("--dry-run");
const codes = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((c) => c.trim().toUpperCase());
if (codes.length === 0) { console.error("pass codes as args"); process.exit(1); }

const { DATABASE_URL, TG_TOKEN, VK_TOKEN } = process.env;
if (!DATABASE_URL) throw new Error("DATABASE_URL required");

const pool = new pg.Pool({ connectionString: DATABASE_URL });

const expiryStr = (() => {
  const d = new Date(); d.setDate(d.getDate() + 30);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" });
})();

const bonusMsgPlain =
  `🎁 +100 R$ зачислено на счёт!\n\n` +
  `Спасибо за отзыв! Действуют до ${expiryStr}.\n\n` +
  `Это бонус к следующей прямой покупке в боте или на robloxbank.ru — отдельно он не выдаётся и к покупке на WB не применяется. Бонус добавится к номиналу автоматически.`;

const bonusMsgHtml =
  `🎁 <b>+100 R$ зачислено на счёт!</b>\n\n` +
  `Спасибо за отзыв! Действуют до ${expiryStr}.\n\n` +
  `Это бонус к следующей прямой покупке в боте или на robloxbank.ru — отдельно он не выдаётся и к покупке на WB не применяется. Бонус добавится к номиналу автоматически.`;

async function vkSend(peerId, message) {
  if (!VK_TOKEN) { console.warn("[VK] VK_TOKEN not set, skipping"); return; }
  const keyboard = JSON.stringify({
    inline: true,
    buttons: [[{ action: { type: "text", label: "💎 Купить напрямую", payload: JSON.stringify({ command: "start_direct" }) }, color: "positive" }]],
  });
  const params = new URLSearchParams({
    access_token: VK_TOKEN, peer_id: String(peerId), message,
    keyboard, random_id: String(Date.now()), v: "5.131",
  });
  const res = await fetch(`https://api.vk.com/method/messages.send?${params}`);
  const json = await res.json();
  if (json.error) console.warn(`[VK] send to ${peerId} failed:`, json.error.error_msg);
  else console.log(`  ✅ VK message sent to ${peerId} (msg id ${json.response})`);
  return json;
}

async function tgSend(chatId, html) {
  if (!TG_TOKEN) { console.warn("[TG] TG_TOKEN not set, skipping"); return; }
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const json = await res.json();
  if (!json.ok) console.warn(`[TG] send to ${chatId} failed:`, json.description);
  else console.log(`  ✅ TG message sent to ${chatId}`);
  return json;
}

async function main() {
  for (const code of codes) {
    console.log(`\n══════════ ${code} ══════════`);
    const client = await pool.connect();
    let user = null, paid = false;
    try {
      await client.query("BEGIN");
      // Idempotency guard: only proceed if the bonus wasn't already claimed.
      const upd = await client.query(
        `UPDATE "WbCode" SET "reviewBonusClaimed" = true
         WHERE UPPER(code) = $1 AND "reviewBonusClaimed" = false
         RETURNING code, "userId"`, [code]
      );
      if (upd.rowCount === 0) {
        await client.query("ROLLBACK");
        console.log("  ⚠️ Already claimed or code missing — skipping (idempotent).");
        client.release();
        continue;
      }
      const userId = upd.rows[0].userId;
      if (DRY_RUN) {
        const { rows } = await client.query(`SELECT id, "vkId", "tgId", name, balance FROM "User" WHERE id=$1`, [userId]);
        await client.query("ROLLBACK");
        console.log("  [DRY-RUN] would credit +100 R$ to", rows[0]);
        client.release();
        continue;
      }
      const ures = await client.query(
        `UPDATE "User"
         SET balance = balance + 100, "reviewBonusGrantedAt" = NOW(), "reviewReminderLevel" = 0
         WHERE id = $1
         RETURNING id, "vkId", "tgId", name, balance`, [userId]
      );
      await client.query("COMMIT");
      user = ures.rows[0];
      paid = true;
      console.log(`  ✅ Credited +100 R$ → new balance ${user.balance} (user: ${user.name})`);
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("  ❌ DB error:", e.message);
      client.release();
      continue;
    }
    client.release();

    if (paid && user) {
      if (user.vkId) await vkSend(user.vkId, bonusMsgPlain);
      else if (user.tgId) await tgSend(user.tgId, bonusMsgHtml);
      else console.warn("  ⚠️ user has no vkId/tgId — cannot notify");
    }
  }
  await pool.end();
  console.log("\n✅ Done.");
}
main().catch((e) => { console.error(e); pool.end().finally(() => process.exit(1)); });
