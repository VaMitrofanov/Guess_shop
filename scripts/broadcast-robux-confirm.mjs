#!/usr/bin/env node
/**
 * Рассылка «✅ Робуксы поступили» (27.10.2026). Владелец: подтверждение, что
 * робуксы дошли, — самое важное для нас. Покупатель жмёт кнопку, когда робуксы
 * появятся на балансе (или сразу, если уже появились); бот пишет OrderEvent
 * ROBUX_SURVEY_GOT (команда `rbx_s_got`), его видит карточка заказа и
 * `scripts/robux-survey-report.mjs`.
 *
 * Аудитория: COMPLETED-выкуп за DAYS дней (не тест), последний выкуп ещё не
 * подтверждён. Пропускаем тех, кто 26.10 получил опрос с той же кнопкой
 * (журнал `data/broadcast-pending-check-2026-10-26.log`, метка `survey`).
 * TG, иначе VK. Повторный запуск шлёт только неотправленным (свой журнал).
 *
 * Использование: npx tsx scripts/broadcast-robux-confirm.mjs [--dry-run] [--days=30] [--include-surveyed]
 */
import fs from "node:fs";
import pg from "pg";
import dotenv from "dotenv";
import { robuxConfirmText, ROBUX_CONFIRM, NO_ROBUX_SHORT_BUTTON } from "../bots/shared/robux-eta.ts";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const DRY_RUN = process.argv.includes("--dry-run");
const INCLUDE_SURVEYED = process.argv.includes("--include-surveyed");
const DAYS = Number(process.argv.find((a) => a.startsWith("--days="))?.split("=")[1] ?? 30);
const JOURNAL = "data/broadcast-robux-confirm-2026-10-27.log";
const SURVEY_JOURNAL = "data/broadcast-pending-check-2026-10-26.log";
const { DATABASE_URL, TG_TOKEN, VK_TOKEN } = process.env;
if (!DATABASE_URL || !TG_TOKEN || !VK_TOKEN) throw new Error("DATABASE_URL, TG_TOKEN, VK_TOKEN required");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readIds = (file, label) => new Set(fs.existsSync(file)
  ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => l.split("\t")).filter((c) => !label || c[2] === label).map((c) => c[0])
  : []);

const TG_KB = { inline_keyboard: [
  [{ text: ROBUX_CONFIRM.label, callback_data: ROBUX_CONFIRM.command }],
  [{ text: NO_ROBUX_SHORT_BUTTON, callback_data: "rbx_chk" }],
] };
const VK_KB = JSON.stringify({ inline: true, buttons: [
  [{ action: { type: "text", label: ROBUX_CONFIRM.label, payload: JSON.stringify({ command: ROBUX_CONFIRM.command }) }, color: "positive" }],
  [{ action: { type: "text", label: NO_ROBUX_SHORT_BUTTON, payload: JSON.stringify({ command: "rbx_chk" }) }, color: "secondary" }],
] });

async function tgSend(chatId, text) {
  const j = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: TG_KB }),
  }).then((r) => r.json());
  return j.ok ? null : `${j.error_code} ${j.description}`;
}

async function vkSend(userId, text) {
  const j = await fetch("https://api.vk.com/method/messages.send", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: VK_TOKEN, v: "5.131", user_id: String(userId),
      random_id: String(2710_0000 + (Number(userId) % 9_000_000)), message: text, dont_parse_links: "1", keyboard: VK_KB,
    }),
  }).then((r) => r.json());
  return j.error ? `${j.error.error_code} ${j.error.error_msg}` : null;
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1 });
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (u.id) u.id, u."tgId", u."vkId", o.id AS "orderId", o.amount
         FROM "WbOrder" o JOIN "User" u ON u.id = o."userId"
        WHERE o.status = 'COMPLETED' AND o."isTest" = false
          AND o."completedAt" > now() - make_interval(days => $1)
          AND (u."tgId" IS NOT NULL OR u."vkId" IS NOT NULL)
        ORDER BY u.id, o."completedAt" DESC
     ) last
     WHERE NOT EXISTS (SELECT 1 FROM "OrderEvent" e WHERE e."orderId" = last."orderId" AND e.type = 'ROBUX_SURVEY_GOT')`,
    [DAYS],
  );
  await pool.end();

  const done = readIds(JOURNAL);
  const surveyed = INCLUDE_SURVEYED ? new Set() : readIds(SURVEY_JOURNAL, "survey");
  const todo = rows.filter((r) => !done.has(r.id) && !surveyed.has(r.id));
  const tg = todo.filter((r) => r.tgId).length;
  console.log(`${DRY_RUN ? "DRY RUN: " : ""}${DAYS} дн., не подтвердили: ${rows.length}; пропуск — получили опрос 26.10: ${rows.filter((r) => surveyed.has(r.id)).length}, уже отправлено: ${rows.filter((r) => done.has(r.id)).length}; к отправке ${todo.length} (TG ${tg}, VK ${todo.length - tg})`);
  if (DRY_RUN) { console.log("\n--- TG ---\n" + robuxConfirmText("html", 800)); return; }

  const res = { tgOk: 0, tgFail: 0, vkOk: 0, vkFail: 0 };
  const errors = {};
  fs.mkdirSync("data", { recursive: true });
  for (const u of todo) {
    let err = null;
    let via = null;
    if (u.tgId) {
      err = await tgSend(u.tgId, robuxConfirmText("html", u.amount));
      via = "tg";
      if (err) { res.tgFail++; errors[err] = (errors[err] ?? 0) + 1; } else res.tgOk++;
      await sleep(60);
    }
    if (u.vkId && (!u.tgId || err)) {
      const e = await vkSend(u.vkId, robuxConfirmText("plain", u.amount));
      if (e) { res.vkFail++; errors[`vk ${e}`] = (errors[`vk ${e}`] ?? 0) + 1; } else { res.vkOk++; err = null; via = "vk"; }
      await sleep(350);
    }
    if (!err) fs.appendFileSync(JOURNAL, `${u.id}\t${via}\t${new Date().toISOString()}\n`);
  }
  console.log(JSON.stringify(res));
  console.log("ошибки:", JSON.stringify(errors));
}

main().catch((e) => { console.error(e?.message ?? e); process.exitCode = 1; });
