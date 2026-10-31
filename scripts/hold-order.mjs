#!/usr/bin/env node
/**
 * ❄️ Заморозить / разморозить заказ по коду — из терминала.
 *
 * Нужен, когда заморозку надо поставить ДО того, как заказ появится в TWA:
 * код уже на руках у покупателя, а заказа ещё нет (случай 84CR7UZ). В TWA то
 * же самое делается кнопкой ❄️ в карточке; здесь — тот же путь для кодов без
 * карточки и для разовых операций.
 *
 *   node scripts/hold-order.mjs --code CVX3PHS --reason "1 звезда на WB" --by Вадим
 *   node scripts/hold-order.mjs --code CVX3PHS --release --by Вадим
 *   node scripts/hold-order.mjs --list
 *
 * Без `--apply` только показывает, что изменится.
 */
import 'dotenv/config';
import pg from 'pg';

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const code    = (arg('code') || '').trim().toUpperCase();
const reason  = (arg('reason') || '').trim().slice(0, 300);
const by      = (arg('by') || 'админ').trim();
const release = args.includes('--release');
const list    = args.includes('--list');
const apply   = args.includes('--apply');

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

/** Свежая строка сверху — история заметки не затирается. */
const stamp = () => new Date().toLocaleString('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

async function showActive() {
  const { rows } = await client.query(`
    SELECT h."wbCode", h.reason, h."createdBy", h."createdAt",
           o.id AS order_id, o.status, o.amount, o."heldAt"
      FROM "OrderHold" h
      LEFT JOIN "WbOrder" o ON o."wbCode" = h."wbCode"
     WHERE h."releasedAt" IS NULL
     ORDER BY h."createdAt" DESC
  `);
  if (rows.length === 0) { console.log('Активных заморозок нет.'); return; }
  console.log(`\n❄️  Активных заморозок: ${rows.length}\n`);
  for (const r of rows) {
    const where = r.order_id
      ? `заказ ${r.status}${r.heldAt ? ' · помечен' : ' · ЖДЁТ ПОМЕТКИ'}`
      : 'заказа ещё нет — заморозка ждёт его создания';
    console.log(`  ${r.wbCode}  ${String(r.amount ?? '—').padStart(5)} R$  ${where}`);
    console.log(`    ${r.reason}  (${r.createdBy}, ${new Date(r.createdAt).toLocaleString('ru-RU')})\n`);
  }
}

if (list) { await showActive(); await client.end(); process.exit(0); }

if (!code) {
  console.error('Использование: --code <КОД> [--reason "..."] [--release] [--by имя] [--apply] | --list');
  await client.end();
  process.exit(2);
}
if (!release && !reason) {
  console.error('Причина обязательна: --reason "почему нельзя выкупать"');
  await client.end();
  process.exit(2);
}

const { rows: orderRows } = await client.query(
  `SELECT id, status, amount, "adminNote", "heldAt", "robloxUsername" FROM "WbOrder" WHERE "wbCode" = $1`,
  [code],
);
const order = orderRows[0] ?? null;
const { rows: codeRows } = await client.query(
  `SELECT denomination, status FROM "WbCode" WHERE code = $1`, [code],
);
const wbCode = codeRows[0] ?? null;

console.log(`\nКод:   ${code}`);
console.log(`Заказ: ${order ? `${order.id} · ${order.status} · ${order.amount} R$ · ${order.robloxUsername ?? 'ник не указан'}` : 'НЕТ (заморозка сядет на него при создании)'}`);
console.log(`WbCode: ${wbCode ? `${wbCode.denomination} R$ · ${wbCode.status}` : 'нет записи'}`);
console.log(release ? `Действие: РАЗМОРОЗИТЬ (${by})` : `Действие: ЗАМОРОЗИТЬ — «${reason}» (${by})`);

if (!apply) {
  console.log('\n(dry-run; добавь --apply, чтобы записать)\n');
  await client.end();
  process.exit(0);
}

const now = new Date();
if (release) {
  await client.query(
    `UPDATE "OrderHold" SET "releasedAt" = $2, "releasedBy" = $3, "updatedAt" = $2 WHERE "wbCode" = $1 AND "releasedAt" IS NULL`,
    [code, now, by],
  );
  if (order?.heldAt) {
    const line = `[РАЗМОРОЗКА ${stamp()} · ${by}] заморозка снята`;
    await client.query(
      `UPDATE "WbOrder" SET "heldAt" = NULL, "heldReason" = NULL, "heldBy" = NULL, "adminNote" = $2, "updatedAt" = $3 WHERE id = $1`,
      [order.id, `${line}\n${order.adminNote ?? ''}`.trim().slice(0, 2000), now],
    );
  }
  console.log('\n✅ Разморожено.\n');
} else {
  await client.query(`
    INSERT INTO "OrderHold" (id, "wbCode", reason, "createdBy", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $4)
    ON CONFLICT ("wbCode") DO UPDATE
      SET reason = EXCLUDED.reason, "createdBy" = EXCLUDED."createdBy",
          "createdAt" = EXCLUDED."createdAt", "updatedAt" = EXCLUDED."updatedAt",
          "releasedAt" = NULL, "releasedBy" = NULL
  `, [code, reason, by, now]);

  if (order && !order.heldAt) {
    const line = `[ЗАМОРОЗКА ${stamp()} · ${by}] ${reason}`;
    await client.query(
      `UPDATE "WbOrder" SET "heldAt" = $2, "heldReason" = $3, "heldBy" = $4, "adminNote" = $5, "updatedAt" = $2 WHERE id = $1`,
      [order.id, now, reason, by, `${line}\n${order.adminNote ?? ''}`.trim().slice(0, 2000)],
    );
    console.log('\n✅ Заморожено: и код, и заказ.\n');
  } else if (order) {
    await client.query(
      `UPDATE "WbOrder" SET "heldReason" = $2, "heldBy" = $3, "updatedAt" = $4 WHERE id = $1`,
      [order.id, reason, by, now],
    );
    console.log('\n✅ Причина заморозки обновлена.\n');
  } else {
    console.log('\n✅ Код заморожен. Заказа ещё нет — заморозка сядет на него при создании.\n');
  }
}

await showActive();
await client.end();
