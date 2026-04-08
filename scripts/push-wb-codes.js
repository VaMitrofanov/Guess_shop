#!/usr/bin/env node
/**
 * push-wb-codes.js — подключается через WebSocket (порт 443, не 5432)
 * Решает ETIMEDOUT на MacOS когда провайдер блокирует порт 5432.
 *
 * Перед первым запуском:
 *   npm install @neondatabase/serverless ws
 *
 * Запуск:
 *   node scripts/push-wb-codes.js codes.csv
 */

const path = require('path');
const fs   = require('fs');

// Загружаем .env
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// ── Config ─────────────────────────────────────────────────────────────────
const CSV_PATH = path.resolve(process.cwd(), process.argv[2] || 'codes.csv');
const BATCH    = 100;

// Добавляй новые номиналы сюда при необходимости
const VALID_DENOMINATIONS = new Set([200, 300, 500, 800, 1000, 1200, 2000]);

// ── Проверяем наличие @neondatabase/serverless ─────────────────────────────
let neonModule;
try {
  neonModule = require('@neondatabase/serverless');
} catch {
  console.error(`
❌ Пакет @neondatabase/serverless не установлен.

Выполни в корне проекта:
  npm install @neondatabase/serverless ws

Затем снова запусти скрипт.
`);
  process.exit(1);
}

const { neon } = neonModule;

// ── Парсим CSV ─────────────────────────────────────────────────────────────
function parseCsv(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Файл не найден: ${filePath}`);
    process.exit(1);
  }

  const lines   = fs.readFileSync(filePath, 'utf-8').split('\n');
  const headers = lines[0].toLowerCase().split(',').map(h => h.trim());

  const cIdx = headers.indexOf('code');
  const dIdx = headers.indexOf('denomination');
  const bIdx = headers.indexOf('batch');

  if (cIdx === -1 || dIdx === -1) {
    console.error('❌ CSV должен содержать колонки: code, denomination');
    process.exit(1);
  }

  const rows = [];
  let skippedBadDenom = 0;

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(',');
    if (parts.length < 2) continue;

    const code  = (parts[cIdx] ?? '').trim().toUpperCase();
    const denom = parseInt(parts[dIdx], 10);
    const batch = bIdx !== -1 ? (parts[bIdx] ?? '').trim() || 'batch-01' : 'batch-01';

    if (!code) continue;

    if (!VALID_DENOMINATIONS.has(denom)) {
      skippedBadDenom++;
      continue;
    }

    rows.push({ code, denomination: denom, batch });
  }

  if (skippedBadDenom > 0) {
    console.warn(`⚠️  Пропущено строк с неизвестным номиналом: ${skippedBadDenom}`);
    console.warn(`   Разрешённые: ${[...VALID_DENOMINATIONS].join(', ')}`);
  }

  return rows;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('❌ DATABASE_URL не найден в .env');
    process.exit(1);
  }

  // neon() — HTTP/WebSocket клиент, работает на порту 443
  const sql = neon(dbUrl);

  // ── Шаг 0: проверяем соединение ────────────────────────────
  console.log('🔌 Подключаемся к Neon (WebSocket/443)...');
  await sql`SELECT 1`;
  console.log('✅ Соединение успешно\n');

  // ── Шаг 1: создаём таблицу если нет ─────────────────────────
  console.log('⚙️  Проверяем таблицу WbCode...');
  await sql`
    CREATE TABLE IF NOT EXISTS "WbCode" (
      "id"           TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
      "code"         TEXT         NOT NULL,
      "denomination" INTEGER      NOT NULL,
      "isUsed"       BOOLEAN      NOT NULL DEFAULT false,
      "usedAt"       TIMESTAMPTZ,
      "batch"        TEXT,
      "createdAt"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      CONSTRAINT "WbCode_pkey" PRIMARY KEY ("id")
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS "WbCode_code_key"        ON "WbCode"("code")`;
  await sql`CREATE INDEX       IF NOT EXISTS "WbCode_isUsed_idx"       ON "WbCode"("isUsed")`;
  await sql`CREATE INDEX       IF NOT EXISTS "WbCode_denomination_idx" ON "WbCode"("denomination")`;
  console.log('✅ Таблица готова\n');

  // ── Шаг 2: парсим CSV ────────────────────────────────────────
  const rows = parseCsv(CSV_PATH);
  if (rows.length === 0) {
    console.log('⚠️  Нет валидных строк для загрузки.');
    return;
  }
  console.log(`📂 Найдено строк для загрузки: ${rows.length}`);

  // ── Шаг 3: вставляем батчами ─────────────────────────────────
  let inserted = 0;
  let skipped  = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);

    // neon() тегированный шаблон не поддерживает динамические списки VALUES,
    // поэтому строим через обычный запрос с unnest
    const codes   = chunk.map(r => r.code);
    const denoms  = chunk.map(r => r.denomination);
    const batches = chunk.map(r => r.batch);

    const result = await sql`
      INSERT INTO "WbCode" ("code", "denomination", "batch")
      SELECT * FROM UNNEST(
        ${codes}::text[],
        ${denoms}::integer[],
        ${batches}::text[]
      )
      ON CONFLICT ("code") DO NOTHING
      RETURNING "id"
    `;

    inserted += result.length;
    skipped  += chunk.length - result.length;

    process.stdout.write(`  ⏳ ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`);
  }

  console.log(`\n✅ Готово!   Добавлено: ${inserted}   Дублей пропущено: ${skipped}`);

  // ── Итоговая статистика ───────────────────────────────────────
  const stats = await sql`
    SELECT denomination,
           COUNT(*)                                          AS total,
           SUM(CASE WHEN "isUsed" THEN 1 ELSE 0 END)::int  AS used
    FROM "WbCode"
    GROUP BY denomination
    ORDER BY denomination
  `;

  console.log('\n📊 Остаток кодов в базе:');
  console.log('  Номинал    Всего   Использовано   Свободно');
  console.log('  ---------+-------+--------------+---------');
  for (const r of stats) {
    const avail = r.total - r.used;
    console.log(
      `  ${(r.denomination + ' R$').padEnd(9)}  ${String(r.total).padEnd(7)}  ${String(r.used).padEnd(14)} ${avail}`
    );
  }
}

main().catch(e => {
  console.error('\n❌ Ошибка:', e?.message ?? String(e));
  if (e?.detail)  console.error('   Детали:',     e.detail);
  if (e?.hint)    console.error('   Подсказка:',  e.hint);
  if (e?.code)    console.error('   Код:',        e.code);
  process.exit(1);
});
