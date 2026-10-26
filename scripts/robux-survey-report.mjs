#!/usr/bin/env node
/**
 * Итог опроса «пришли ли робуксы?» (рассылка 26.10.2026).
 *
 * Ответы пишут боты в OrderEvent (`ROBUX_SURVEY_GOT|PENDING|NONE`, по заказу —
 * последний ответ). Сколько опросов ушло — журнал рассылки
 * `data/broadcast-pending-check-2026-10-26.log` (строки с меткой `survey`).
 *
 * Использование: node scripts/robux-survey-report.mjs
 */
import fs from "node:fs";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const JOURNAL = "data/broadcast-pending-check-2026-10-26.log";
const LABEL = {
  ROBUX_SURVEY_GOT: "✅ уже на балансе",
  ROBUX_SURVEY_PENDING: "⏳ в Pending",
  ROBUX_SURVEY_NONE: "❌ ни в Pending, ни на балансе",
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const { rows } = await pool.query(`
  SELECT DISTINCT ON (e."orderId") e."orderId", e.type, e.payload->>'via' AS via, e."createdAt",
         o."wbCode", o.amount, o."completedAt"
    FROM "OrderEvent" e JOIN "WbOrder" o ON o.id = e."orderId"
   WHERE e.type LIKE 'ROBUX_SURVEY_%'
   ORDER BY e."orderId", e."createdAt" DESC`);
await pool.end();

let sent = null;
if (fs.existsSync(JOURNAL)) {
  sent = fs.readFileSync(JOURNAL, "utf8").split("\n").filter((l) => l.split("\t")[2] === "survey").length;
}

const by = {};
for (const r of rows) by[r.type] = (by[r.type] ?? 0) + 1;
const total = rows.length;
console.log(`Опрос «пришли ли робуксы?»: ответили ${total}${sent ? ` из ${sent} доставленных (${Math.round((total / sent) * 100)} %)` : ""}`);
for (const type of Object.keys(LABEL)) {
  const n = by[type] ?? 0;
  console.log(`  ${LABEL[type]}: ${n}${total ? ` (${Math.round((n / total) * 100)} %)` : ""}`);
}
const none = rows.filter((r) => r.type === "ROBUX_SURVEY_NONE");
if (none.length) {
  console.log("\n❌ Проверить вручную (скрин Transactions должен прийти менеджеру):");
  for (const r of none) console.log(`  ${r.wbCode} · ${r.amount} R$ · ${r.via}`);
}
