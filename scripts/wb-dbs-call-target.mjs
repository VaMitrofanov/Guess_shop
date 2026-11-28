#!/usr/bin/env node
/**
 * Z1 из docs/wb-voice-call-plan.md — разведка подменного номера WB.
 *
 * Спрашивает у Wildberries `POST /api/v3/dbs/orders/client` по одному заказу и
 * показывает, что реально приходит: есть ли подменный номер и какие поля отдаёт WB.
 *
 * Добавочный для IVR подменного номера — это ПОСЛЕДНИЕ ТРИ ЦИФРЫ НОМЕРА ЗАКАЗА
 * (проверено владельцем на живых звонках 23.08). Поле `phoneCode` из ответа WB к
 * этому отношения не имеет: у заказа 5514551464 оно равно 17885146.
 *
 * ЛОКАЛЬНЫЙ РАЗВЕДЫВАТЕЛЬНЫЙ СКРИПТ. Не для прода, не для CI, не для крона.
 *   - по умолчанию номер НЕ печатается, только «есть/нет» и длина;
 *   - настоящий номер показывает только явный флаг --reveal, чтобы владелец мог
 *     набрать его вручную;
 *   - ничего не пишет ни в БД, ни в файлы, ни в логи.
 * Инвариант проекта прежний: телефон покупателя не попадает в хранилища.
 * См. docs/security.md, риск №37.
 *
 * Использование:
 *   node scripts/wb-dbs-call-target.mjs --latest              # свежий живой заказ, номер скрыт
 *   node scripts/wb-dbs-call-target.mjs 5514551464            # конкретный заказ, номер скрыт
 *   node scripts/wb-dbs-call-target.mjs --latest --reveal     # показать номер, чтобы позвонить
 *   node scripts/wb-dbs-call-target.mjs --recent 10           # сводка по 10 заказам, без номеров
 *   node scripts/wb-dbs-call-target.mjs --watch --reveal      # ждать новый заказ и сразу показать, куда звонить
 */
import 'dotenv/config';

const BASE = 'https://marketplace-api.wildberries.ru';
const args = process.argv.slice(2);
const reveal = args.includes('--reveal');
const wantLatest = args.includes('--latest');
const recentIdx = args.indexOf('--recent');
const recentN = recentIdx >= 0 ? Number(args[recentIdx + 1] || 10) : 0;
const explicitIds = args.filter((a) => /^\d{6,}$/.test(a));
const watch = args.includes('--watch');

const token = (process.env.WB_MARKETPLACE_TOKEN || process.env.WB_API_TOKEN || '')
  .trim().replace(/^['"`]|['"`]$/g, '').trim();
if (!token) {
  console.error('Нет WB_API_TOKEN (или WB_MARKETPLACE_TOKEN) в .env');
  process.exit(1);
}

function mask(value) {
  const s = String(value ?? '');
  if (!s) return '';
  return reveal ? s : `${s.slice(0, 1)}…${s.slice(-2)} (${s.length} цифр)`;
}

async function orderIdsFromDb(limit, onlyLive) {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const live = onlyLive ? 'and "cancelledAt" is null and "completedAt" is null' : 'and "cancelledAt" is null';
  const { rows } = await c.query(`
    select "wbOrderId", "supplierStatus", "chatState",
           round(extract(epoch from (now() - coalesce("wbCreatedAt","firstSeenAt")))/60) age_min
    from "WbMarketplaceOrder"
    where "isTest" = false ${live}
    order by coalesce("wbCreatedAt","firstSeenAt") desc limit $1`, [limit]);
  await c.end();
  return rows;
}

async function fetchClients(ids) {
  const r = await fetch(`${BASE}/api/v3/dbs/orders/client`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ orders: ids.map(Number) }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`WB ответил ${r.status}:`, JSON.stringify(body).slice(0, 300));
    process.exit(1);
  }
  return Array.isArray(body?.orders) ? body.orders : [];
}

function report(row, m) {
  const id = String(row.orderID ?? row.orderId ?? '?');
  // IVR подменного номера WB просит ПОСЛЕДНИЕ ТРИ ЦИФРЫ НОМЕРА ЗАКАЗА, а не `phoneCode`
  // (у заказа 5514551464 phoneCode = 17885146, восемь цифр — это не то). Значит добавочный
  // мы знаем сами, из своего же wbOrderId, и WB для этого не нужен.
  const ext = id.slice(-3);
  const number = row.replacementPhone || row.phone;
  console.log(`\n── заказ ${id}${m ? `  ·  ${m.supplierStatus} / ${m.chatState} / ${m.age_min} мин` : ''}`);
  console.log(`   поля от WB:        ${Object.keys(row).join(', ')}`);
  console.log(`   phone:             ${row.phone ? mask(row.phone) : '— пусто'}`);
  console.log(`   replacementPhone:  ${row.replacementPhone ? mask(row.replacementPhone) : '— пусто'}`);
  console.log(`   phoneCode от WB:   ${row.phoneCode != null && row.phoneCode !== '' ? String(row.phoneCode) : '— нет'}  (назначение неизвестно, для дозвона НЕ нужен)`);
  console.log(`   добавочный (IVR):  ${ext}  ← последние 3 цифры номера заказа`);
  console.log(`   additionalPhones:  ${Array.isArray(row.additionalPhones) ? row.additionalPhones.length : 0} шт.`);
  if (!number) { console.log('   ЗВОНИТЬ НЕКУДА: оба поля пустые'); return; }
  if (reveal) {
    console.log(`\n   НАБРАТЬ:           +${number},,,${ext}`);
    console.log('   Робот WB попросит последние три цифры номера заказа — это и есть');
    console.log(`   ${ext}. Запятые = паузы по 2 секунды: на iPhone зажать «*» до появления «,»,`);
    console.log('   на Android — «Добавить паузу 2 сек». Если робот не успеет договорить,');
    console.log(`   добавьте ещё запятую или наберите ${ext} руками после подсказки.`);
  }
}

if (watch) {
  console.log('Жду новый живой DBS-заказ. Проверка каждые 30 секунд, Ctrl+C — выход.');
  const seen = new Set((await orderIdsFromDb(20, true)).map((r) => r.wbOrderId));
  console.log(`Уже известны и пропускаются: ${seen.size} заказ(ов).`);
  for (;;) {
    await new Promise((r) => setTimeout(r, 30_000));
    const rows = await orderIdsFromDb(5, true);
    const fresh = rows.filter((r) => !seen.has(r.wbOrderId));
    for (const r of fresh) seen.add(r.wbOrderId);
    if (!fresh.length) continue;
    process.stdout.write('\u0007');
    console.log(`\n=== НОВЫЙ ЗАКАЗ, ${new Date().toLocaleTimeString('ru-RU')} — звоните сейчас ===`);
    const clients = await fetchClients(fresh.map((r) => r.wbOrderId));
    if (!clients.length) console.log('WB пока не отдаёт контакт по этому заказу — повторите через минуту вручную.');
    for (const row of clients) report(row, fresh.find((r) => r.wbOrderId === String(row.orderID ?? row.orderId)));
  }
}

const meta = new Map();
let ids = explicitIds;
if (!ids.length) {
  const rows = await orderIdsFromDb(recentN || 1, !recentN && wantLatest);
  if (!rows.length) { console.error('В базе нет подходящих заказов.'); process.exit(1); }
  ids = rows.map((r) => r.wbOrderId);
  for (const r of rows) meta.set(r.wbOrderId, r);
}

const rows = await fetchClients(ids);
console.log(`\nЗапрошено заказов: ${ids.length}, WB вернул: ${rows.length}`);
if (rows.length === 0) {
  console.log('WB не отдал данные. Обычно это значит, что заказ ещё не подтверждён (confirm)');
  console.log('или уже закрыт — ручка отдаёт только живые заказы.');
}

for (const row of rows) report(row, meta.get(String(row.orderID ?? row.orderId ?? '?')));

if (!reveal) console.log('\nЧтобы увидеть номер целиком и позвонить: добавьте --reveal');
console.log('Номер никуда не копировать: ни в Trello, ни в docs, ни в переписку.\n');
