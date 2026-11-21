#!/usr/bin/env node
/**
 * Этап 5.9 Блок A (О2 принят владельцем): бэкфилл структурного курса.
 *
 * Что делает:
 *   1. У BUYOUT-записей ledger без rateUsdtPer1000 парсит курс и R$ из comment
 *      («…: 250 R$ × 5.05 USDT / 1000 R$») и пишет их в новые колонки
 *      rateUsdtPer1000 / robuxAmount.
 *   2. Если у партнёра ещё нет ни одной записи PartnerRateChange — создаёт
 *      стартовую запись с текущим Partner.robuxRateUsdtPer1000 (previousRate=null),
 *      чтобы история курса начиналась не с пустоты.
 *
 * Без флагов — dry-run: печатает, что будет изменено. `--apply` — выполняет.
 *
 * Usage: node scripts/anton-backfill-rates.mjs [--apply]
 */
import pg from "pg";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const APPLY = process.argv.includes("--apply");
// «250 R$ × 5.05 USDT / 1000 R$» — формат comment всех трёх путей списания.
// R$-число может содержать пробелы/NBSP-разделители тысяч («19 106 R$»).
const COMMENT_RE = /([\d\s  ]+)R\$\s*×\s*([\d.]+)\s*USDT\s*\/\s*1000\s*R\$/;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows: partners } = await client.query(
  `SELECT id, name, "robuxRateUsdtPer1000" AS rate FROM "Partner" WHERE slug = 'anton'`,
);
if (partners.length !== 1) {
  console.error("Партнёр anton не найден");
  process.exit(1);
}
const partner = partners[0];
console.log(`Партнёр: ${partner.name}, текущий курс ${partner.rate} USDT / 1000 R$`);

const { rows: entries } = await client.query(
  `SELECT id, amount, comment, "createdAt"
   FROM "PartnerLedgerEntry"
   WHERE "partnerId" = $1 AND type = 'BUYOUT' AND "rateUsdtPer1000" IS NULL
   ORDER BY "createdAt"`,
  [partner.id],
);

console.log(`\n=== BUYOUT-записи без структурного курса: ${entries.length} ===`);
let parsed = 0;
let skipped = 0;
for (const entry of entries) {
  const match = COMMENT_RE.exec(entry.comment || "");
  if (!match) {
    skipped += 1;
    console.log(`  SKIP (курс не распознан): ${entry.amount} USDT | ${(entry.comment || "").slice(0, 70)} | id=${entry.id}`);
    continue;
  }
  const robux = Number(match[1].replace(/[\s  ]/g, ""));
  const rate = Number(match[2]);
  if (!Number.isFinite(robux) || robux <= 0 || !Number.isFinite(rate) || rate <= 0) {
    skipped += 1;
    console.log(`  SKIP (числа не распознаны): ${(entry.comment || "").slice(0, 70)} | id=${entry.id}`);
    continue;
  }
  parsed += 1;
  console.log(`  ${APPLY ? "SET " : "will"} rate=${rate} robux=${robux} | ${entry.amount} USDT | id=${entry.id}`);
  if (APPLY) {
    await client.query(
      `UPDATE "PartnerLedgerEntry" SET "rateUsdtPer1000" = $1, "robuxAmount" = $2 WHERE id = $3`,
      [rate, robux, entry.id],
    );
  }
}

const { rows: rateChanges } = await client.query(
  `SELECT COUNT(*)::int AS count FROM "PartnerRateChange" WHERE "partnerId" = $1`,
  [partner.id],
);
const needSeed = rateChanges[0].count === 0;
console.log(`\n=== История курса: записей ${rateChanges[0].count}${needSeed ? " → нужна стартовая" : ""} ===`);
if (needSeed) {
  console.log(`  ${APPLY ? "CREATE" : "will create"} стартовую запись rate=${partner.rate} (previousRate=null, createdBy=backfill)`);
  if (APPLY) {
    await client.query(
      `INSERT INTO "PartnerRateChange" (id, "partnerId", rate, "previousRate", "createdBy")
       VALUES ($1, $2, $3, NULL, 'backfill-20260711')`,
      [randomUUID(), partner.id, partner.rate],
    );
  }
}

console.log(`\nИтого: распознано ${parsed}, пропущено ${skipped}${APPLY ? " — ПРИМЕНЕНО" : " — dry-run (запусти с --apply)"}`);
await client.end();
