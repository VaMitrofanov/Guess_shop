#!/usr/bin/env node
/**
 * Отчёт «недостижимые VK-клиенты» (PLAN +5.I).
 *
 * Скан всех активных заказов VK-юзеров: кому сообщество НЕ может написать
 * (VK error 901 — юзер не разрешил сообщения / диалога никогда не было —
 * типично для активации кода через VK-логин НА САЙТЕ). Ни бот, ни менеджер
 * от имени сообщества до них не достучатся; писать можно только с личного
 * VK-аккаунта менеджера — этот список и есть рабочий чек-лист для этого.
 *
 * Usage:
 *   node scripts/report-unreachable.mjs             # таблица в stdout
 *   node scripts/report-unreachable.mjs --alert     # + отправить список TG-админам
 *   node scripts/report-unreachable.mjs --statuses=AWAITING_GAMEPASS,PENDING
 *
 * Env: DATABASE_URL, VK_TOKEN, VK_GROUP_ID; для --alert ещё TG_TOKEN + ADMIN_IDS.
 * Запускать локально против Neon или из контейнера VK-бота (там все env есть).
 */
import pg from "pg";
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const ALERT = process.argv.includes("--alert");
const statusesArg = process.argv.find((a) => a.startsWith("--statuses="));
const STATUSES = (statusesArg ? statusesArg.split("=")[1] : "AWAITING_GAMEPASS,PENDING,IN_PROGRESS")
  .split(",").map((s) => s.trim()).filter(Boolean);

const { DATABASE_URL, VK_TOKEN, VK_GROUP_ID, TG_TOKEN, ADMIN_IDS } = process.env;
if (!DATABASE_URL) throw new Error("DATABASE_URL required");
if (!VK_TOKEN) throw new Error("VK_TOKEN required (групповой токен с messages)");
if (!VK_GROUP_ID) throw new Error("VK_GROUP_ID required");

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function vkApi(method, params) {
  const qs = new URLSearchParams({ ...params, access_token: VK_TOKEN, v: "5.131" });
  const r = await fetch(`https://api.vk.com/method/${method}?${qs}`);
  const d = await r.json().catch(() => null);
  if (d?.error) throw new Error(`${method}: ${d.error.error_msg}`);
  return d?.response;
}

async function main() {
  const { rows } = await pool.query(
    `SELECT o."wbCode", o.amount, o.status, o."createdAt", u."vkId", u.name
       FROM "WbOrder" o JOIN "User" u ON u.id = o."userId"
      WHERE o.status = ANY($1) AND o."isTest" = false AND u."vkId" IS NOT NULL
      ORDER BY o."createdAt" ASC`,
    [STATUSES],
  );
  console.log(`Активных VK-заказов (${STATUSES.join("/")}): ${rows.length}\n`);

  const unreachable = [];
  for (const r of rows) {
    const uid = Number(r.vkId);
    if (!uid) continue;
    let allowed = null, hadDialog = null;
    try {
      const a = await vkApi("messages.isMessagesFromGroupAllowed", { group_id: VK_GROUP_ID, user_id: uid });
      allowed = !!a?.is_allowed;
    } catch (e) { console.warn(`  ⚠️ ${r.wbCode}: isMessagesFromGroupAllowed — ${e.message}`); }
    if (allowed === false) {
      try {
        const h = await vkApi("messages.getHistory", { peer_id: uid, count: 1 });
        hadDialog = (h?.count ?? 0) > 0;
      } catch { hadDialog = null; }
      unreachable.push({ ...r, uid, hadDialog });
    }
    await sleep(350); // VK rate-limit ~3 rps на групповой токен
  }

  if (unreachable.length === 0) {
    console.log("✅ Все VK-клиенты с активными заказами достижимы.");
    return;
  }

  const totalR = unreachable.reduce((s, u) => s + u.amount, 0);
  const lines = unreachable.map((u) => {
    const reason = u.hadDialog === true ? "запретил сообщения" : u.hadDialog === false ? "диалога нет (актив. с сайта)" : "недоступен";
    return `${u.wbCode} · ${u.amount} R$ · ${u.status} · ${u.name ?? "?"} · vk.com/id${u.uid} · ${reason}`;
  });
  console.log(`🚫 Недостижимы ${unreachable.length} из ${rows.length} (≈${totalR} R$ номинала):\n`);
  for (const l of lines) console.log("  " + l);
  console.log("\nПисать таким можно только с ЛИЧНОГО VK-акка менеджера (по ссылке на профиль).");

  if (ALERT && TG_TOKEN && ADMIN_IDS) {
    const text =
      `🚫 Недостижимые VK-клиенты: ${unreachable.length} (≈${totalR} R$)\n\n` +
      lines.join("\n") +
      `\n\nПисать — только с личного VK-акка менеджера.`;
    for (const id of ADMIN_IDS.split(",").map((s) => s.trim()).filter(Boolean)) {
      await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: id, text, disable_web_page_preview: true }),
      }).catch(() => {});
    }
    console.log("\n📨 Отчёт отправлен TG-админам.");
  }
}

main().then(() => pool.end()).catch((e) => { console.error(e); pool.end(); process.exit(1); });
