#!/usr/bin/env node
/**
 * Сверка бонусного журнала с балансами (ultra-review U3/U4, риск №25).
 *
 * `BonusLedger` задуман как источник правды по движению бонусов, но до 26.07
 * писался далеко не всегда: бот менял `User.balance` напрямую, компенсаций при
 * неудачной оплате не было вовсе. Скрипт показывает, у кого сумма журнала не
 * сходится с текущим балансом, и по желанию доначисляет разницу одной
 * идемпотентной записью-выравниванием.
 *
 * Использование:
 *   node scripts/bonus-ledger-audit.mjs             # только отчёт (dry-run)
 *   node scripts/bonus-ledger-audit.mjs --apply     # + записи выравнивания
 *   node scripts/bonus-ledger-audit.mjs --since=2026-07-12
 *
 * `--apply` НЕ меняет балансы: он только дописывает в журнал недостающую
 * историю, чтобы `SUM(deltaRobux) == balance`. Реальная компенсация клиенту —
 * решение владельца по итогам отчёта.
 */
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const APPLY = process.argv.includes("--apply");
const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const SINCE = sinceArg ? sinceArg.split("=")[1] : null;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query(`
  SELECT u.id,
         u."tgId",
         u."vkId",
         u.balance,
         COALESCE(SUM(l."deltaRobux"), 0)::int AS ledger_sum,
         COUNT(l.id)::int                      AS ledger_rows
  FROM "User" u
  LEFT JOIN "BonusLedger" l ON l."userId" = u.id
  GROUP BY u.id
  HAVING u.balance <> COALESCE(SUM(l."deltaRobux"), 0)
  ORDER BY ABS(u.balance - COALESCE(SUM(l."deltaRobux"), 0)) DESC
`);

console.log(`Расхождений журнал ↔ баланс: ${rows.length}`);
let totalDrift = 0;
for (const r of rows) {
  const drift = r.balance - r.ledger_sum;
  totalDrift += Math.abs(drift);
  console.log(
    `  ${r.id} tg=${r.tgId ?? "-"} vk=${r.vkId ?? "-"} ` +
    `balance=${r.balance} ledger=${r.ledger_sum} (${r.ledger_rows} строк) → расхождение ${drift > 0 ? "+" : ""}${drift}`
  );
}
console.log(`Суммарное расхождение по модулю: ${totalDrift} R$`);

if (SINCE) {
  const { rows: recent } = await client.query(
    `SELECT COUNT(*)::int AS n FROM "BonusLedger" WHERE "createdAt" >= $1`,
    [SINCE],
  );
  console.log(`Записей в журнале с ${SINCE}: ${recent[0].n}`);
}

if (APPLY && rows.length > 0) {
  console.log("\n--apply: дописываю выравнивающие записи…");
  let written = 0;
  for (const r of rows) {
    const drift = r.balance - r.ledger_sum;
    if (drift === 0) continue;
    const key = `ledger-baseline:${r.id}`;
    const res = await client.query(
      `INSERT INTO "BonusLedger" (id, "userId", "deltaRobux", "balanceAfter", reason, "idempotencyKey", metadata, "createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, 'LEDGER_BASELINE', $4, $5, now())
       ON CONFLICT ("idempotencyKey") DO NOTHING`,
      [r.id, drift, r.balance, key, JSON.stringify({ source: "bonus-ledger-audit", ledgerSumBefore: r.ledger_sum })],
    );
    written += res.rowCount ?? 0;
  }
  console.log(`Добавлено записей: ${written}`);
} else if (rows.length > 0) {
  console.log("\nDry-run. Для записи выравнивания запусти с --apply.");
}

await client.end();
