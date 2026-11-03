#!/usr/bin/env node
/**
 * Чистка данных партнёра «Антон» перед приёмкой Этапа 5.7 (решения владельца 2026-07-11).
 * Заменяет anton-cleanup-20260710.mjs. Таблица НЕ трогается — после чистки force-sync
 * пересоздаёт все строки «готово» как DONE-задачи со списаниями (Блок B Этапа 5.7).
 *
 * Что удаляется:
 *   1. Тестовое пополнение ledger (TOPUP ~117.44 USDT, 2026-07-10) — правило 9.
 *   2. Сид-BUYOUT списание XLSX (−96.49 USDT, выкупа не было — подтверждено владельцем).
 *   3. 8 сид-задач XLSX 2026-07-09 (19 106 R$) — прежний П11.
 *   4. Все closedFromSheet-задачи без списаний (вкл. тест Carter_Tiger17, правило 10) —
 *      force-sync после деплоя 5.7 пересоздаст их со списаниями по номиналу C.
 *
 * Приёмка после чистки + force-sync (правило 13):
 *   «Выкуплено» = 40 223 R$ ровно; баланс = 300 − ~203.13 = 96.87 USDT.
 *
 * Без флагов — dry-run: печатает задачи, ledger и баланс до/после, ничего не меняет.
 * `--apply` — выполняет удаления.
 *
 * Usage: node scripts/anton-reset-20260711.mjs [--apply]
 */
import pg from "pg";
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const APPLY = process.argv.includes("--apply");
const TEST_TOPUP_ID = "cmrezu1vb000e01o06qkbu31w"; // TOPUP 117.44 USDT 2026-07-10 — тест
const SEED_BUYOUT_ID = "anton_ledger_20260709_buyout_19106r_usdt"; // сид-списание XLSX
const SEED_TASK_ID_PREFIX = "anton_xlsx_20260709_row"; // 8 сид-задач XLSX
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
          "purchasePriceRobux" AS pprice, note,
          ("sheetRaw"->>'closedFromSheet') AS closed_from_sheet
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
  console.log(`  ${t.status} | ${t.src} | nick=${t.nick} gp=${t.gp} price=${t.pprice ?? t.price} | closedFromSheet=${t.closed_from_sheet} | id=${t.id}`);
}
console.log(`=== Ledger (${ledger.length}), баланс сейчас: ${balance(ledger)} USDT ===`);
for (const e of ledger) {
  console.log(`  ${e.type} ${e.amount} ${e.currency} | task=${e.taskId} | ${(e.comment || "").slice(0, 80)} | id=${e.id}`);
}

// 1–2: ledger-записи к удалению — строго по id, с проверкой типа/суммы перед удалением.
const testTopup = ledger.find((e) => e.id === TEST_TOPUP_ID);
if (testTopup && (testTopup.type !== "TOPUP" || Math.abs(Number(testTopup.amount) - 117.44) > 0.01)) {
  console.error(`⛔ Запись ${TEST_TOPUP_ID} не похожа на тестовый TOPUP 117.44 (${testTopup.type} ${testTopup.amount}) — не трогаю, проверь вручную.`);
  process.exit(1);
}
const seedBuyout = ledger.find((e) => e.id === SEED_BUYOUT_ID);

// 3: сид-задачи XLSX (по id-префиксу миграции или маркеру в note).
const seedTasks = tasks.filter((t) => t.id.startsWith(SEED_TASK_ID_PREFIX) || (t.note || "").includes(SEED_NOTE_MARKER));

// 4: closedFromSheet-задачи без списаний (после деплоя 5.7 force-sync пересоздаст их
// из строк «готово» уже со списаниями). Guard: задачи с ledger-записями не трогаем.
const ledgerTaskIds = new Set(ledger.filter((e) => e.taskId).map((e) => e.taskId));
const closedFromSheetTasks = tasks.filter((t) =>
  t.closed_from_sheet === "true" && !seedTasks.some((s) => s.id === t.id) && !ledgerTaskIds.has(t.id));
const skippedClosedWithLedger = tasks.filter((t) => t.closed_from_sheet === "true" && ledgerTaskIds.has(t.id));

const targetTaskIds = [...new Set([...seedTasks, ...closedFromSheetTasks].map((t) => t.id))];
const targetLedgerIds = [
  ...(testTopup ? [testTopup.id] : []),
  ...(seedBuyout ? [seedBuyout.id] : []),
  // ledger-записи, привязанные к удаляемым задачам (кроме уже учтённого сид-BUYOUT)
  ...ledger.filter((e) => e.taskId && targetTaskIds.includes(e.taskId) && e.id !== SEED_BUYOUT_ID).map((e) => e.id),
];

console.log(`\n=== К удалению ===`);
console.log(`Тестовый TOPUP 117.44: ${testTopup ? `найден (${testTopup.amount} USDT, id=${testTopup.id})` : "НЕ НАЙДЕН (возможно, уже удалён)"}`);
console.log(`Сид-BUYOUT −96.49: ${seedBuyout ? `найден (${seedBuyout.amount} USDT, id=${seedBuyout.id})` : "НЕ НАЙДЕН (возможно, уже удалён)"}`);
console.log(`Сид-задачи XLSX: ${seedTasks.length} шт.`);
for (const t of seedTasks) console.log(`  ${t.status} nick=${t.nick} gp=${t.gp} price=${t.pprice ?? t.price} id=${t.id}`);
console.log(`closedFromSheet без списаний: ${closedFromSheetTasks.length} шт.`);
for (const t of closedFromSheetTasks) console.log(`  ${t.status} nick=${t.nick} gp=${t.gp} price=${t.pprice ?? t.price} id=${t.id}`);
if (skippedClosedWithLedger.length > 0) {
  console.log(`⚠️ closedFromSheet СО списаниями (не трогаю — деньги уже учтены): ${skippedClosedWithLedger.length} шт.`);
  for (const t of skippedClosedWithLedger) console.log(`  ${t.status} nick=${t.nick} gp=${t.gp} id=${t.id}`);
}
console.log(`Ledger-записей к удалению: ${targetLedgerIds.length}`);

const remainingLedger = ledger.filter((e) => !targetLedgerIds.includes(e.id));
const remainingTasks = tasks.filter((t) => !targetTaskIds.includes(t.id));
console.log(`\nПосле чистки: задач ${remainingTasks.length}, баланс ${balance(remainingLedger)} USDT (сейчас ${balance(ledger)}).`);
console.log(`Дальше: деплой 5.7 → force-sync в TWA пересоздаст строки «готово» как DONE со списаниями.`);
console.log(`Приёмка (правило 13): «Выкуплено» = 40 223 R$, баланс ≈ 96.87 USDT.`);

if (!APPLY) {
  console.log("\nDRY-RUN: ничего не изменено. Запусти с --apply для выполнения.");
  await client.end();
  process.exit(0);
}

await client.query("BEGIN");
try {
  if (targetLedgerIds.length > 0) {
    await client.query(`DELETE FROM "PartnerLedgerEntry" WHERE id = ANY($1)`, [targetLedgerIds]);
  }
  if (targetTaskIds.length > 0) {
    await client.query(`DELETE FROM "PartnerBuyoutTask" WHERE id = ANY($1)`, [targetTaskIds]);
  }
  await client.query("COMMIT");
  console.log(`\n✅ Удалено: задач ${targetTaskIds.length}, ledger-записей ${targetLedgerIds.length}.`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("❌ Ошибка, откат:", err.message);
  process.exit(1);
}
await client.end();
