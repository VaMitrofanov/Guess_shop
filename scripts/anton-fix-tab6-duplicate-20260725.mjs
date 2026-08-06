#!/usr/bin/env node
/**
 * Сверка партнёра «Антон» с боевой Google-таблицей (2026-07-25) и приведение БД под таблицу.
 * Таблица — источник истины (решение владельца).
 *
 * Что нашла сверка:
 *   1. Лист «6» переименован владельцем в «19/07/2026». `externalRowId` собирается из
 *      НАЗВАНИЯ листа, поэтому sync 19.07 в 08:54 импортировал те же 16 физических строк
 *      (`6:2…6:17` → `19/07/2026:2…17`) второй раз и списал их повторно:
 *      10 605 R$ = 53.57 USDT. Листа «6» в таблице больше нет → задачи-сироты.
 *   2. Баланс подгоняли пополнениями, которых нет в столбце «додеп»:
 *      103.02 (19.07, в таблице 100) + 50.51 + 0.03 (22.07) = лишние 53.56 USDT.
 *   Итог: баланс сходился случайно, а «Выкуплено»/«Потрачено»/«Пополнено» были завышены.
 *
 * Что делает скрипт:
 *   A. 16 задач-дублей листа «6» → CANCELLED (+ маркеры в sheetRaw). Строки-оригиналы
 *      под `19/07/2026:*` и их списания не трогаем. Write-back в таблицу НЕ делаем:
 *      листа «6» больше нет, а физические строки принадлежат оригиналам.
 *   B. Видимое сторно REFUND +53.60 USDT (`robuxAmount=-10605`, `itemCount=-16`):
 *      53.57 — сумма повторных списаний, +0.03 — накопленное построчное округление
 *      (таблица считает от общей суммы). С 53.60 «Потрачено» и «Баланс» совпадают
 *      с таблицей до копейки.
 *   C. Пополнения под таблицу: удалить 50.51 и 0.03; 103.02 заменить на 100
 *      (той же датой 19.07 03:54, чтобы цепочка «додеп» совпадала с листами).
 *
 * Приёмка (цифры таблицы на 2026-07-25):
 *   Пополнено 800.00 USDT · Выкуплено 151 205 R$ (126 DONE) · Потрачено 763.59 USDT ·
 *   Баланс 36.41 USDT (в таблице 36.41475).
 *
 * Без флагов — dry-run. `--apply` — выполняет изменения в одной транзакции.
 * Usage: node scripts/anton-fix-tab6-duplicate-20260725.mjs [--apply]
 */
import pg from "pg";
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const APPLY = process.argv.includes("--apply");

const DUP_TAB = "6";
const DUP_ROWS = 16;
const DUP_ROBUX = 10605;
const REFUND_USDT = 53.6;
const REFUND_ID = "anton_refund_20260725_tab6_rename";
const REFUND_BATCH = "correction:tab6-rename-20260725";
const OPERATOR = "claude: tab6 rename correction 2026-07-25";
const TASK_NOTE = "Дубль переименованного листа «6» → «19/07/2026»; сторно 2026-07-25";

// Пополнения-подгонки (id + ожидаемая сумма для guard'а).
const TOPUPS_TO_DELETE = [
  { id: "cmrvv9qle000b01mr63852r3j", amount: 50.51 },
  { id: "cmrvva0rb000d01mr5x3y30qy", amount: 0.03 },
];
const TOPUP_TO_REPLACE = { id: "cmrroheq0001g01rx4nzb9xmi", amount: 103.02, sheetAmount: 100, at: "2026-07-19T03:54:00.000Z" };
const REPLACEMENT_TOPUP_ID = "anton_topup_20260719_100_usdt";

// Ожидаемые цифры таблицы (эталон).
const SHEET = { dodep: 800, doneRobux: 151205, spent: 763.59, balance: 36.41 };

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows: partners } = await client.query(`SELECT id FROM "Partner" WHERE slug = 'anton'`);
if (partners.length !== 1) {
  console.error("⛔ Партнёр anton не найден");
  process.exit(1);
}
const partnerId = partners[0].id;

const state = async () => {
  const { rows: [led] } = await client.query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'TOPUP'), 0) AS topup,
            COALESCE(SUM(amount) FILTER (WHERE type IN ('BUYOUT', 'REFUND')), 0) AS spent,
            COALESCE(SUM(amount), 0) AS balance
     FROM "PartnerLedgerEntry" WHERE "partnerId" = $1 AND currency = 'USDT'`,
    [partnerId],
  );
  const { rows: [tasks] } = await client.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'DONE') AS done,
            COALESCE(SUM(COALESCE("purchasePriceRobux", "priceRobux")) FILTER (WHERE status = 'DONE'), 0) AS done_robux
     FROM "PartnerBuyoutTask" WHERE "partnerId" = $1`,
    [partnerId],
  );
  const r2 = (v) => Math.round(Number(v) * 100) / 100;
  return { topup: r2(led.topup), spent: r2(Math.abs(led.spent)), balance: r2(led.balance), done: Number(tasks.done), doneRobux: Number(tasks.done_robux) };
};

const report = (label, s) => {
  console.log(`${label}: пополнено ${s.topup} · выкуплено ${s.doneRobux} R$ (${s.done} DONE) · потрачено ${s.spent} · баланс ${s.balance}`);
};

// --- Guards -----------------------------------------------------------------
const { rows: dupTasks } = await client.query(
  `SELECT id, status, "externalRowId" AS row_id, "robloxUsername" AS nick, "gamepassId" AS gp,
          COALESCE("purchasePriceRobux", "priceRobux") AS rbx
   FROM "PartnerBuyoutTask"
   WHERE "partnerId" = $1 AND "externalRowId" LIKE $2
   ORDER BY (split_part("externalRowId", ':', 3))::int`,
  [partnerId, `%:${DUP_TAB}:%`],
);
const dupRobux = dupTasks.reduce((s, t) => s + Number(t.rbx || 0), 0);
console.log(`=== Задачи-дубли листа «${DUP_TAB}» (${dupTasks.length}) ===`);
for (const t of dupTasks) {
  console.log(`  ${t.row_id.split(":").slice(1).join(":").padEnd(6)} ${t.status.padEnd(9)} ${(t.nick || "-").padEnd(22)} gp=${String(t.gp).padEnd(12)} ${String(t.rbx).padStart(5)} R$`);
}
console.log(`  итого ${dupRobux} R$`);

if (dupTasks.length !== DUP_ROWS || dupRobux !== DUP_ROBUX) {
  console.error(`⛔ Ожидались ${DUP_ROWS} задач на ${DUP_ROBUX} R$, найдено ${dupTasks.length} на ${dupRobux} R$ — не трогаю, проверь вручную.`);
  process.exit(1);
}
const notDone = dupTasks.filter((t) => t.status !== "DONE");
if (notDone.length > 0) {
  console.error(`⛔ Не все дубли в DONE (${notDone.map((t) => `${t.row_id}=${t.status}`).join(", ")}) — похоже, сторно уже делали. Останавливаюсь.`);
  process.exit(1);
}

// Оригиналы под новым названием листа обязаны существовать — иначе отменять дубли нельзя.
const { rows: [twin] } = await client.query(
  `SELECT COUNT(*) AS n, COALESCE(SUM(COALESCE("purchasePriceRobux", "priceRobux")), 0) AS rbx
   FROM "PartnerBuyoutTask"
   WHERE "partnerId" = $1 AND "externalRowId" LIKE '%:19/07/2026:%' AND status = 'DONE'`,
  [partnerId],
);
console.log(`Оригиналы «19/07/2026»: ${twin.n} DONE, ${twin.rbx} R$`);
if (Number(twin.n) < DUP_ROWS) {
  console.error(`⛔ Оригиналов меньше, чем дублей (${twin.n} < ${DUP_ROWS}) — останавливаюсь.`);
  process.exit(1);
}

const { rows: existingRefund } = await client.query(
  `SELECT id FROM "PartnerLedgerEntry" WHERE id = $1 OR ("partnerId" = $2 AND "batchId" = $3)`,
  [REFUND_ID, partnerId, REFUND_BATCH],
);
if (existingRefund.length > 0) {
  console.error(`⛔ Сторно уже есть в ledger (${existingRefund.map((r) => r.id).join(", ")}) — останавливаюсь.`);
  process.exit(1);
}

const topupIds = [...TOPUPS_TO_DELETE.map((t) => t.id), TOPUP_TO_REPLACE.id];
const { rows: topups } = await client.query(
  `SELECT id, type, amount, "taskId", "createdAt" FROM "PartnerLedgerEntry" WHERE "partnerId" = $1 AND id = ANY($2::text[])`,
  [partnerId, topupIds],
);
console.log(`\n=== Пополнения-подгонки ===`);
for (const expected of [...TOPUPS_TO_DELETE, TOPUP_TO_REPLACE]) {
  const found = topups.find((t) => t.id === expected.id);
  if (!found) {
    console.error(`⛔ Пополнение ${expected.id} (${expected.amount} USDT) не найдено — останавливаюсь.`);
    process.exit(1);
  }
  if (found.type !== "TOPUP" || found.taskId || Math.abs(Number(found.amount) - expected.amount) > 0.001) {
    console.error(`⛔ Запись ${expected.id} не похожа на ожидаемый TOPUP ${expected.amount} (${found.type} ${found.amount}, task=${found.taskId}) — останавливаюсь.`);
    process.exit(1);
  }
  const action = expected === TOPUP_TO_REPLACE ? `→ заменить на ${TOPUP_TO_REPLACE.sheetAmount} (по «додеп»)` : "→ удалить";
  console.log(`  ${found.createdAt.toISOString().slice(0, 16)} ${String(found.amount).padStart(7)} USDT ${action}`);
}

const before = await state();
console.log("");
report("Сейчас", before);
console.log(`Таблица: пополнено ${SHEET.dodep} · выкуплено ${SHEET.doneRobux} R$ · потрачено ${SHEET.spent} · баланс ${SHEET.balance} (36.41475)`);
console.log(`\nПлан: A) ${DUP_ROWS} задач → CANCELLED · B) REFUND +${REFUND_USDT} USDT (${DUP_ROBUX} R$) · C) пополнения → ${SHEET.dodep} USDT`);

if (!APPLY) {
  console.log("\nDRY-RUN: ничего не изменено. Запусти с --apply для выполнения.");
  await client.end();
  process.exit(0);
}

// --- Apply ------------------------------------------------------------------
await client.query("BEGIN");
try {
  // A. Дубли → CANCELLED. Списания под ними остаются: их закрывает сторно из шага B,
  //    чтобы в истории было видно и ошибку, и исправление.
  const dupIds = dupTasks.map((t) => t.id);
  const { rowCount: cancelled } = await client.query(
    `UPDATE "PartnerBuyoutTask"
     SET status = 'CANCELLED', note = $3, error = NULL, "updatedAt" = NOW(),
         "sheetRaw" = COALESCE("sheetRaw", '{}'::jsonb) || $4::jsonb
     WHERE "partnerId" = $1 AND id = ANY($2::text[]) AND status = 'DONE'`,
    [partnerId, dupIds, TASK_NOTE, JSON.stringify({
      duplicateOfRenamedTab: "19/07/2026",
      duplicateCorrectionAt: new Date().toISOString(),
      rowDeletedFromSheet: true,
    })],
  );
  if (cancelled !== DUP_ROWS) throw new Error(`отменено ${cancelled} задач вместо ${DUP_ROWS}`);

  // B. Видимое сторно.
  await client.query(
    `INSERT INTO "PartnerLedgerEntry"
       (id, "partnerId", "taskId", type, amount, currency, "rateUsdtPer1000", "robuxAmount",
        "purchaseAccountName", "batchId", "itemCount", reference, comment, "createdBy")
     VALUES ($1, $2, NULL, 'REFUND', $3, 'USDT', 5.05, $4, NULL, $5, $6, $7, $8, $9)`,
    [
      REFUND_ID, partnerId, REFUND_USDT, -DUP_ROBUX, REFUND_BATCH, -DUP_ROWS, REFUND_BATCH,
      `Сторно двойного импорта: лист «${DUP_TAB}» переименован в «19/07/2026», ${DUP_ROWS} строк списаны повторно (${DUP_ROBUX} R$); включает 0.03 USDT построчного округления`,
      OPERATOR,
    ],
  );

  // C. Пополнения под столбец «додеп» таблицы.
  const { rowCount: deleted } = await client.query(
    `DELETE FROM "PartnerLedgerEntry" WHERE "partnerId" = $1 AND id = ANY($2::text[]) AND type = 'TOPUP' AND "taskId" IS NULL`,
    [partnerId, topupIds],
  );
  if (deleted !== topupIds.length) throw new Error(`удалено ${deleted} пополнений вместо ${topupIds.length}`);
  await client.query(
    `INSERT INTO "PartnerLedgerEntry" (id, "partnerId", type, amount, currency, comment, "createdBy", "createdAt")
     VALUES ($1, $2, 'TOPUP', $3, 'USDT', $4, $5, $6)`,
    [
      REPLACEMENT_TOPUP_ID, partnerId, TOPUP_TO_REPLACE.sheetAmount,
      `Пополнение баланса партнёра в USDT (сверка 2026-07-25: было ${TOPUP_TO_REPLACE.amount}, в таблице «додеп» = ${TOPUP_TO_REPLACE.sheetAmount})`,
      OPERATOR, TOPUP_TO_REPLACE.at,
    ],
  );

  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  console.error("⛔ Откат:", error.message);
  await client.end();
  process.exit(1);
}

const after = await state();
console.log("");
report("После", after);
const ok = after.topup === SHEET.dodep && after.doneRobux === SHEET.doneRobux
  && after.spent === SHEET.spent && after.balance === SHEET.balance;
console.log(ok
  ? "✅ Совпадает с таблицей (пополнено/выкуплено/потрачено/баланс)."
  : `⚠️ Есть расхождение с таблицей: ожидалось ${JSON.stringify(SHEET)}, получилось ${JSON.stringify(after)}`);
await client.end();
