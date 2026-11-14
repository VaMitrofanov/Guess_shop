#!/usr/bin/env node
/**
 * push-wb-codes.js — единственный загрузчик кодов WB в БД.
 *
 * Запуск:
 *   node scripts/push-wb-codes.js codes.csv            # загрузка
 *   node scripts/push-wb-codes.js codes.csv --dry-run  # только отчёт, без записи
 *
 * CSV: обязательный заголовок с колонками code, denomination и (опционально) batch.
 * Порядок колонок любой.
 *
 * Главная гарантия: после успешного прогона КАЖДЫЙ код из CSV присутствует в БД.
 * Скрипт проверяет это отдельным запросом после вставки и падает с ненулевым exit
 * code, если хоть один код не доехал. Молчаливого «✅ ГОТОВО» при потерянных кодах
 * больше быть не может — именно так карта 6QYDK79 оказалась напечатана, но не в базе
 * (инцидент 15–16.07, см. docs/database.md).
 *
 * Пишет через Prisma Client, а не сырой SQL: схема WbCode уже уезжала от скриптов
 * (id/updatedAt остались без DEFAULT), и raw INSERT молча падал по not-null.
 */

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const CSV_PATH = path.resolve(process.cwd(), process.argv[2] || '');
const DRY_RUN = process.argv.includes('--dry-run');

// Добавляй новые номиналы сюда при печати нового тиража.
const VALID_DENOMINATIONS = new Set([200, 300, 500, 800, 1000, 1200, 2000]);

/** Neon: direct-хост иногда таймаутит, пулер на том же порту — нет. Зеркалит src/lib/prisma.ts. */
function buildPoolerUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.hostname.includes('-pooler.')) return raw;
    u.hostname = u.hostname.replace(/^(ep-[^.]+)(\.)/, '$1-pooler$2');
    u.searchParams.delete('channel_binding');
    return u.toString();
  } catch {
    return raw;
  }
}

/** Разбирает CSV. Бросает на любой некорректной строке — тихого skip быть не должно. */
function parseCsv(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`Файл не найден: ${filePath || '<не указан>'}\nЗапуск: node scripts/push-wb-codes.js codes.csv`);
  }

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').map(l => l.replace(/\r$/, ''));
  const headerLine = lines.find(l => l.trim());
  if (!headerLine) throw new Error('CSV пустой');

  const headers = headerLine.split(',').map(h => h.trim().toLowerCase());
  const cIdx = headers.indexOf('code');
  const dIdx = headers.indexOf('denomination');
  const bIdx = headers.indexOf('batch');
  if (cIdx === -1 || dIdx === -1) {
    throw new Error(`CSV должен содержать колонки code и denomination. Найдено: ${headers.join(', ')}`);
  }

  const rows = [];
  const problems = [];
  const seen = new Map();

  for (let i = lines.indexOf(headerLine) + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;

    const parts = raw.split(',');
    const code = (parts[cIdx] ?? '').trim().toUpperCase();
    const denomRaw = (parts[dIdx] ?? '').trim();
    const denomination = Number.parseInt(denomRaw, 10);
    const batch = bIdx !== -1 ? (parts[bIdx] ?? '').trim() || null : null;

    const lineNo = i + 1;
    if (!code) { problems.push(`строка ${lineNo}: пустой code`); continue; }
    if (!Number.isInteger(denomination)) { problems.push(`строка ${lineNo}: код ${code} — номинал не число («${denomRaw}»)`); continue; }
    if (!VALID_DENOMINATIONS.has(denomination)) {
      problems.push(`строка ${lineNo}: код ${code} — номинал ${denomination} не в списке разрешённых (${[...VALID_DENOMINATIONS].join(', ')})`);
      continue;
    }
    if (seen.has(code)) { problems.push(`строка ${lineNo}: код ${code} дублируется в CSV (первый раз — строка ${seen.get(code)})`); continue; }

    seen.set(code, lineNo);
    rows.push({ code, denomination, batch });
  }

  if (problems.length) {
    throw new Error(
      `CSV содержит ${problems.length} некорректных строк — ни один код не загружен.\n` +
      `Раньше такие строки молча пропускались, из-за чего напечатанные коды не попадали в БД.\n\n` +
      problems.map(p => `  • ${p}`).join('\n') +
      `\n\nПочини CSV и запусти снова.`
    );
  }
  if (rows.length === 0) throw new Error('В CSV нет ни одной строки с кодом');

  return rows;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL не найден в .env / .env.local');

  const rows = parseCsv(CSV_PATH);
  console.log(`📂 ${path.basename(CSV_PATH)}: ${rows.length} валидных кодов`);

  const byDenom = {};
  for (const r of rows) byDenom[r.denomination] = (byDenom[r.denomination] || 0) + 1;
  console.log(`   Состав: ${Object.entries(byDenom).map(([d, n]) => `${n}×${d}`).join(', ')}`);

  const pool = new Pool({ connectionString: buildPoolerUrl(dbUrl), max: 3, connectionTimeoutMillis: 15_000 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const codes = rows.map(r => r.code);
    const existingBefore = await prisma.wbCode.findMany({ where: { code: { in: codes } }, select: { code: true } });
    const existingSet = new Set(existingBefore.map(r => r.code));
    const fresh = rows.filter(r => !existingSet.has(r.code));

    console.log(`\n🔎 Уже в БД: ${existingSet.size}   К вставке: ${fresh.length}`);

    if (DRY_RUN) {
      console.log('\n🧪 --dry-run: ничего не записано.');
      if (fresh.length) console.log(`   Вставились бы: ${fresh.slice(0, 10).map(r => r.code).join(', ')}${fresh.length > 10 ? ` … и ещё ${fresh.length - 10}` : ''}`);
      return;
    }

    // createMany + Prisma сам проставит id (cuid) и updatedAt по схеме.
    const { count: inserted } = await prisma.wbCode.createMany({ data: fresh, skipDuplicates: true });

    // Главная проверка: КАЖДЫЙ код из CSV обязан быть в БД.
    const presentAfter = await prisma.wbCode.findMany({ where: { code: { in: codes } }, select: { code: true } });
    const presentSet = new Set(presentAfter.map(r => r.code));
    const missing = codes.filter(c => !presentSet.has(c));

    console.log(`\n✅ Вставлено: ${inserted}   Уже были (дубли): ${existingSet.size}`);
    console.log(`🔒 Сверка: в CSV ${codes.length} = вставлено ${inserted} + дубли ${existingSet.size}${inserted + existingSet.size === codes.length ? '' : '  ← НЕ СХОДИТСЯ'}`);

    if (missing.length) {
      throw new Error(
        `${missing.length} кодов из CSV отсутствуют в БД после загрузки:\n` +
        missing.map(c => `  • ${c}`).join('\n') +
        `\n\nЭти карты нельзя пускать в печать/продажу — клиент получит «Код не найден».`
      );
    }
    if (inserted + existingSet.size !== codes.length) {
      throw new Error('Сверка не сошлась: вставлено + дубли ≠ строк CSV. Загрузка неполная, разбирайся до отправки тиража.');
    }

    console.log(`✅ Все ${codes.length} кодов подтверждены в БД.`);

    const stats = await prisma.wbCode.groupBy({
      by: ['denomination', 'status'],
      _count: { _all: true },
      orderBy: { denomination: 'asc' },
    });
    const table = {};
    for (const s of stats) {
      const d = `${s.denomination} R$`;
      table[d] = table[d] || { AVAILABLE: 0, RESERVED: 0, CLAIMED: 0 };
      table[d][s.status] = s._count._all;
    }
    console.log('\n📊 Остаток кодов в базе:');
    console.table(table);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch(e => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
