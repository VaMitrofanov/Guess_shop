#!/usr/bin/env node
/**
 * One-off чистка данных партнёра «Антон» (решения владельца 2026-07-10):
 *
 * 1. Удалить ПРОВЕРОЧНУЮ задачу Carter_Tiger17 (GP 1903128619) — тест sync,
 *    закрыта из таблицы без списания.
 * 2. Удалить сид-задачи «Импортировано из XLSX 2026-07-09; выкуплено до подключения
 *    Google Sheets sync» вместе с их BUYOUT-списаниями: владелец удалил их строки
 *    из таблицы вручную и подтвердил, что выкупа не было — они не должны
 *    вычитаться из баланса и не должны нигде отображаться.
 *
 * Без флагов — dry-run: печатает задачи, ledger и баланс до/после, ничего не меняет.
 * `--apply` — выполняет удаления.
 *
 * Usage: node scripts/anton-cleanup-20260710.mjs [--apply]
 */
import pg from "pg";
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const APPLY = process.argv.includes("--apply");
const TEST_GAMEPASS_ID = "1903128619"; // Carter_Tiger17, проверочный
const SEED_NOTE_MARKER = "выкуплено до подключения Google Sheets sync";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows: partners } = await client.query(`SELECT id, name FROM "Partner" WHERE slug = 'anton'`);
if (partners.length !== 1) {
  console.error("Партнёр anton не найден");
  process.exit(1);
}
const partnerId = partners[0].id;

const { rows: tasks } = await client.query(
  `SELECT id, status, "externalSource" AS src, "externalRowId" AS row_id,
          "robloxUsername" AS nick, "gamepassId" AS gp, "priceRobux" AS price,
          "purchasePriceRobux" AS pprice, note, "completedAt"
   FROM "PartnerBuyoutTask" WHERE "partnerId" = $1 ORDER BY "createdAt"`,
  [partnerId],
);
const { rows: ledger } = await client.query(
  `SELECT id, type, amount, currency, reference, comment, "taskId", "createdAt"
   FROM "PartnerLedgerEntry" WHERE "partnerId" = $1 ORDER BY "createdAt"`,
  [partnerId],
);

const balance = (entries) => Math.round(entries.reduce((s, e) => s + Number(e.amount), 0) * 100) / 100;
console.log(`=== Все задачи (${tasks.length}) ===`);
for (const t of tasks) {
  console.log(`  ${t.status} | ${t.src} | nick=${t.nick} gp=${t.gp} price=${t.price ?? t.pprice} | note=${(t.note || "").slice(0, 70)} | id=${t.id}`);
}
console.log(`=== Ledger (${ledger.length}), баланс сейчас: ${balance(ledger)} USDT ===`);
for (const e of ledger) {
  console.log(`  ${e.type} ${e.amount} ${e.currency} | ref=${e.reference} task=${e.taskId} | ${(e.comment || "").slice(0, 80)} | id=${e.id}`);
}

const testTasks = tasks.filter((t) => t.gp === TEST_GAMEPASS_ID);
const seedTasks = tasks.filter((t) => (t.note || "").includes(SEED_NOTE_MARKER));
const targetTaskIds = new Set([...testTasks, ...seedTasks].map((t) => t.id));
const targetLedger = ledger.filter((e) => e.taskId && targetTaskIds.has(e.taskId));
const testLedger = ledger.filter((e) => e.taskId && testTasks.some((t) => t.id === e.taskId));

console.log(`\n=== К удалению ===`);
console.log(`Проверочная задача (GP ${TEST_GAMEPASS_ID}): ${testTasks.length} шт.`);
for (const t of testTasks) console.log(`  ${t.status} nick=${t.nick} price=${t.price ?? t.pprice} id=${t.id}`);
console.log(`Сид-задачи «${SEED_NOTE_MARKER}»: ${seedTasks.length} шт.`);
for (const t of seedTasks) console.log(`  ${t.status} nick=${t.nick} gp=${t.gp} price=${t.price ?? t.pprice} id=${t.id}`);
console.log(`Привязанные ledger-записи: ${targetLedger.length} шт., сумма ${balance(targetLedger)} USDT`);
for (const e of targetLedger) console.log(`  ${e.type} ${e.amount} | ${(e.comment || "").slice(0, 80)} | id=${e.id}`);

const orphanSeedLedger = ledger.filter((e) =>
  !e.taskId && e.type === "BUYOUT" && /xlsx|19\s?106|96[.,]49/i.test(e.comment || ""));
if (orphanSeedLedger.length > 0) {
  console.log(`\n⚠️ Найдены BUYOUT-записи БЕЗ привязки к задачам, похожие на сид-списание XLSX:`);
  for (const e of orphanSeedLedger) console.log(`  ${e.amount} | ${(e.comment || "").slice(0, 90)} | id=${e.id}`);
  console.log("Они тоже будут удалены при --apply (сид-выкуп признан владельцем не состоявшимся).");
}

if (testLedger.length > 0) {
  console.error(`\n⛔ У проверочной задачи есть ledger-записи (${testLedger.length}) — проверь вручную, скрипт её не тронет.`);
}

const remaining = ledger.filter((e) =>
  !(e.taskId && targetTaskIds.has(e.taskId)) && !orphanSeedLedger.some((o) => o.id === e.id));
console.log(`\nБаланс после чистки: ${balance(remaining)} USDT (сейчас ${balance(ledger)})`);

if (!APPLY) {
  console.log("\nDRY-RUN: ничего не изменено. Запусти с --apply для выполнения.");
  await client.end();
  process.exit(0);
}

await client.query("BEGIN");
try {
  const ledgerIds = [...targetLedger.map((e) => e.id), ...orphanSeedLedger.map((e) => e.id)];
  if (ledgerIds.length > 0) {
    await client.query(`DELETE FROM "PartnerLedgerEntry" WHERE id = ANY($1)`, [ledgerIds]);
  }
  const taskIds = [
    ...(testLedger.length === 0 ? testTasks.map((t) => t.id) : []),
    ...seedTasks.map((t) => t.id),
  ];
  if (taskIds.length > 0) {
    await client.query(`DELETE FROM "PartnerBuyoutTask" WHERE id = ANY($1)`, [taskIds]);
  }
  await client.query("COMMIT");
  console.log(`\n✅ Удалено: задач ${taskIds.length}, ledger-записей ${ledgerIds.length}.`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("❌ Ошибка, откат:", err.message);
  process.exit(1);
}
await client.end();
