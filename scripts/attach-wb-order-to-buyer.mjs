#!/usr/bin/env node
/**
 * Привязать существующий заказ по коду ВБ к реальному аккаунту покупателя.
 *
 * Заказ на выкуп, открытый оператором вручную из раздела DBS, вешается на
 * служебного пользователя `tgId: "admin"` — гейт-код к моменту создания ещё
 * никем не активирован, а значит `WbCode.userId` пуст. Покупатель после этого
 * не получает ни уведомлений о заказе, ни «Мой заказ» в боте. Скрипт
 * перевешивает заказ и код на настоящего человека.
 *
 *   node scripts/attach-wb-order-to-buyer.mjs --code CAA4BR9 --tg 6669690346
 *   node scripts/attach-wb-order-to-buyer.mjs --code CAA4BR9 --tg 6669690346 --apply
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
const code = (arg('code') || '').trim().toUpperCase();
const tgId = (arg('tg') || '').trim();
const vkId = (arg('vk') || '').trim();
const apply = args.includes('--apply');

if (!code || (!tgId && !vkId)) {
  console.error('Использование: --code <КОД> (--tg <tgId> | --vk <vkId>) [--apply]');
  process.exit(1);
}

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
  const { rows: [user] } = await c.query(
    tgId
      ? `select id, "tgId", "vkId", name, username from "User" where "tgId"=$1`
      : `select id, "tgId", "vkId", name, username from "User" where "vkId"=$1`,
    [tgId || vkId],
  );
  if (!user) throw new Error(`Пользователь ${tgId || vkId} не найден`);

  const { rows: [order] } = await c.query(
    `select o.id, o."wbCode", o.amount, o.status, o."orderSource", o."robloxUsername", o."userId",
            u."tgId" as owner_tg, u.name as owner_name
       from "WbOrder" o left join "User" u on u.id=o."userId" where o."wbCode"=$1`,
    [code],
  );
  if (!order) throw new Error(`Заказ по коду ${code} не найден`);

  const { rows: [wbCode] } = await c.query(
    `select id, code, denomination, status, "isUsed", "userId" from "WbCode" where code=$1`,
    [code],
  );

  console.log('Покупатель :', user.id, user.tgId ?? user.vkId, user.name, user.username ? `@${user.username}` : '(без username)');
  console.log('Заказ      :', order.id, `${order.amount} R$`, order.status, order.orderSource, `ник ${order.robloxUsername ?? '—'}`);
  console.log('Сейчас на  :', order.userId, order.owner_tg, order.owner_name);
  console.log('WbCode     :', wbCode ? `${wbCode.code} · userId ${wbCode.userId ?? '—'} · ${wbCode.status}` : '— нет строки —');

  if (order.userId === user.id) {
    console.log('\nЗаказ уже привязан к этому пользователю — делать нечего.');
    process.exit(0);
  }
  if (!apply) {
    console.log('\nDRY-RUN. Повторите с --apply, чтобы применить.');
    process.exit(0);
  }

  await c.query('begin');
  await c.query(`update "WbOrder" set "userId"=$1, "updatedAt"=now() where id=$2`, [user.id, order.id]);
  if (wbCode) {
    await c.query(`update "WbCode" set "userId"=$1, "updatedAt"=now() where id=$2`, [user.id, wbCode.id]);
  }
  const note = `[ПРИВЯЗКА ${new Date().toISOString().slice(0, 10)}] заказ перевешен с ${order.owner_name ?? order.userId} на ${user.name ?? user.tgId ?? user.vkId}`;
  await c.query(
    `update "WbOrder" set "adminNote" = left(coalesce($1 || E'\\n' || "adminNote", $1), 2000) where id=$2`,
    [note, order.id],
  );
  await c.query('commit');
  console.log('\nГотово: заказ и код привязаны к', user.name ?? user.tgId ?? user.vkId);
} catch (error) {
  await c.query('rollback').catch(() => {});
  console.error('Ошибка:', error.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
