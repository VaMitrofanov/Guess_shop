#!/usr/bin/env node
/**
 * One-off: link a gamepass URL to an existing WbOrder by wbCode,
 * then notify the user and send admin order card.
 *
 * Usage:
 *   node scripts/link-gamepass-order.mjs <WB_CODE> <GAMEPASS_URL> [--dry-run]
 *
 * Example:
 *   node scripts/link-gamepass-order.mjs THRC7TM "https://www.roblox.com/games/127926411525036/poop223383s-Place#!/store"
 */

import pg from "pg";
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const DRY_RUN = process.argv.includes("--dry-run");

const WB_CODE      = process.argv[2];
const GAMEPASS_URL = process.argv[3];

if (!WB_CODE || !GAMEPASS_URL) {
  console.error("Usage: node scripts/link-gamepass-order.mjs <WB_CODE> <GAMEPASS_URL>");
  process.exit(1);
}

const { DATABASE_URL, TG_TOKEN, VK_TOKEN, ADMIN_IDS: ADMIN_IDS_RAW } = process.env;
if (!DATABASE_URL || !TG_TOKEN) throw new Error("DATABASE_URL and TG_TOKEN required");

const ADMIN_IDS = (ADMIN_IDS_RAW ?? "").split(",").map(s => s.trim()).filter(Boolean);

// ── DB ────────────────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function query(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

// ── TG API ────────────────────────────────────────────────────────────────────

async function tgSend(chatId, text, extra = {}) {
  const body = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra };
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) console.warn(`[TG] Send to ${chatId} failed:`, json.description);
  return json;
}

// ── VK API ────────────────────────────────────────────────────────────────────

async function vkSend(peerId, message) {
  if (!VK_TOKEN) { console.warn("[VK] VK_TOKEN not set, skipping VK notification"); return; }
  const params = new URLSearchParams({
    access_token: VK_TOKEN,
    peer_id:      String(peerId),
    message,
    random_id:    String(Date.now()),
    v:            "5.131",
  });
  const res = await fetch(`https://api.vk.com/method/messages.send?${params}`);
  const json = await res.json();
  if (json.error) console.warn(`[VK] Send to ${peerId} failed:`, json.error.error_msg);
  return json;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function formatDate(d) {
  return new Date(d).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit",
  }) + " МСК";
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Fetch order + user
  const [order] = await query(`
    SELECT o.*, u."tgId", u."vkId", u.username, u.name, u.image
    FROM "WbOrder" o
    LEFT JOIN "User" u ON u.id = o."userId"
    WHERE o."wbCode" = $1
  `, [WB_CODE]);

  if (!order) {
    console.error(`❌ Order with wbCode=${WB_CODE} not found`);
    process.exit(1);
  }

  console.log("📦 Found order:");
  console.log(`   id:     ${order.id}`);
  console.log(`   status: ${order.status}`);
  console.log(`   amount: ${order.amount} R$`);
  console.log(`   platform: ${order.platform}`);
  console.log(`   user tgId: ${order.tgId}`);
  console.log(`   user vkId: ${order.vkId}`);
  console.log(`   current gamepassUrl: ${order.gamepassUrl}`);

  if (!["AWAITING_GAMEPASS", "REJECTED"].includes(order.status)) {
    console.warn(`⚠️  Order status is "${order.status}" — expected AWAITING_GAMEPASS or REJECTED. Continuing anyway.`);
  }

  // 2. Update order
  if (!DRY_RUN) {
    await query(`
      UPDATE "WbOrder"
      SET "gamepassUrl" = $1,
          status = 'PENDING',
          "rejectionReason" = NULL,
          "adminId" = NULL,
          "updatedAt" = NOW()
      WHERE "wbCode" = $2
    `, [GAMEPASS_URL, WB_CODE]);
    console.log(`✅ Updated order: gamepassUrl set, status → PENDING`);
  } else {
    console.log(`[DRY-RUN] Would update: gamepassUrl=${GAMEPASS_URL}, status=PENDING`);
  }

  const shortId    = order.id.slice(-6).toUpperCase();
  const passPrice  = Math.ceil(order.amount / 0.7);
  const dateStr    = formatDate(order.createdAt);
  const twaUrl     = `https://robloxbank.ru/twa?q=${encodeURIComponent(shortId)}`;

  // User label
  let userLabel = order.username ? `@${order.username}` : (order.name || "Пользователь");
  if (order.tgId) userLabel += ` (ID: ${order.tgId})`;

  // Previous orders count
  const [{ cnt }] = await query(`SELECT COUNT(*) as cnt FROM "WbOrder" WHERE "userId" = $1`, [order.userId]);
  const prev = Math.max(0, Number(cnt) - 1);
  const loyaltyLine =
    prev >= 5 ? `👑 <b>VIP КЛИЕНТ (${prev} заказов)</b>\n` :
    prev >= 1 ? `🔄 <b>ПОВТОРНЫЙ КЛИЕНТ</b>\n` : "";

  const platformEmoji = order.platform === "TG" ? "📱" : "📘";

  // 3. Send user notification
  const userMsg =
    `🎉 Отлично, геймпасс принят!\n\n` +
    `🆔 Номер заявки: <code>${shortId}</code>\n\n` +
    `⏳ Выкупим в течение нескольких часов — обычно быстрее. Как только будет готово — напишем.\n` +
    `💡 <i>Робуксы начислит Roblox — обычно в течение 5–7 дней после выкупа.</i>`;

  if (!DRY_RUN) {
    if (order.tgId) {
      await tgSend(order.tgId, userMsg);
      console.log(`✅ User notified via TG (id: ${order.tgId})`);
    } else if (order.vkId) {
      const vkMsg = userMsg.replace(/<[^>]+>/g, "");
      await vkSend(order.vkId, vkMsg);
      console.log(`✅ User notified via VK (id: ${order.vkId})`);
    } else {
      console.warn("⚠️  No tgId or vkId found for user — cannot notify user");
    }
  } else {
    console.log(`[DRY-RUN] Would send user notification to ${order.tgId ? "TG " + order.tgId : "VK " + order.vkId}`);
  }

  // 4. Send admin card
  const adminText =
    `📦 <b>ЗАКАЗ #${shortId}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    loyaltyLine +
    `${platformEmoji} Источник: <b>${order.platform}</b>\n` +
    `📅 Время: <b>${dateStr}</b>\n` +
    `👤 Юзер: ${escapeHtml(userLabel)}\n` +
    `💎 Сумма: <b>${order.amount} R$</b> (Геймпасс: ${passPrice} R$)\n` +
    `🔑 Код ВБ: <code>${WB_CODE}</code>\n` +
    `📊 Статус: ⏳ В обработке\n\n` +
    `🔗 <a href="${GAMEPASS_URL}">Открыть Gamepass</a>`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: "✅ ВЫКУПЛЕНО", callback_data: `admin_ok:${order.id}` },
        { text: "❌ ОШИБКА",    callback_data: `admin_reject_init:${order.id}` },
      ],
      [
        { text: "📊 Открыть в дашборде", web_app: { url: twaUrl } },
      ],
    ],
  };

  if (!DRY_RUN) {
    for (const adminId of ADMIN_IDS) {
      await tgSend(adminId, adminText, { reply_markup, link_preview_options: { is_disabled: true } });
    }
    console.log(`✅ Admin card sent to ${ADMIN_IDS.length} admin(s): ${ADMIN_IDS.join(", ")}`);
  } else {
    console.log(`[DRY-RUN] Would send admin card to: ${ADMIN_IDS.join(", ")}`);
    console.log("Admin card text:", adminText);
  }

  await pool.end();
  console.log("✅ Done.");
}

main().catch(err => {
  console.error("Fatal error:", err);
  pool.end().finally(() => process.exit(1));
});
