#!/usr/bin/env node
/**
 * Выгрузка следа покупателя по коду заказа — для разбора спора.
 *
 * Разбор 28.08.2026 по `CEALJKV`: покупательница утверждала, что не указывала
 * ник, на который ушли робуксы. Доказать удалось только косвенно — прямых
 * записей «ввела такой-то ник тогда-то» не существовало. Теперь они пишутся
 * (`bots/shared/order-audit.ts`), а это их читалка: одна команда — готовый
 * текст, который можно приложить к спору.
 *
 * Usage: node scripts/order-audit-trail.mjs <КОД> [<КОД> ...]
 */
import pg from "pg";
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const codes = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((c) => c.trim().toUpperCase());
if (codes.length === 0) {
  console.error("Usage: node scripts/order-audit-trail.mjs <КОД> [<КОД> ...]");
  process.exit(1);
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const msk = (d) => new Date(d).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });

for (const code of codes) {
  console.log(`\n═══════════ ${code} ═══════════\n`);

  const { rows: orders } = await client.query(
    `SELECT o.id, o."wbCode", o.amount, o.status, o.platform, o."orderSource",
            o."robloxUsername", o."probableNick", o."gamepassId", o."createdAt",
            o."completedAt", o."adminNote",
            u."tgId", u."vkId", u.username, u.name
       FROM "WbOrder" o JOIN "User" u ON u.id = o."userId"
      WHERE o."wbCode" = $1`, [code]);

  if (orders.length === 0) { console.log("Заказ не найден."); continue; }
  const o = orders[0];

  const who = o.tgId ? `Telegram ${o.tgId}${o.username ? ` (@${o.username})` : ""}` : `VK ${o.vkId}`;
  console.log(`Заказ ${o.amount} R$ · ${o.status} · ${o.orderSource} · создан ${msk(o.createdAt)}`);
  console.log(`Покупатель: ${who}${o.name ? ` · ${o.name}` : ""}`);
  console.log(`Подтверждённый ник: ${o.robloxUsername ?? "—"}`);
  console.log(`Выкупленный геймпасс: ${o.gamepassId ?? "—"}`);
  if (o.completedAt) console.log(`Выкуплен: ${msk(o.completedAt)}`);

  const { rows: events } = await client.query(
    `SELECT type, payload, "createdAt" FROM "OrderEvent"
      WHERE "orderId" = $1 AND type IN ('AUDIT_NICK_ENTERED','AUDIT_GAMEPASS_SUBMITTED')
      ORDER BY "createdAt"`, [o.id]);

  console.log(`\n── Что клиент вводил и присылал (${events.length}) ──`);
  if (events.length === 0) {
    console.log("Записей нет — заказ старше механизма аудита (введён 28.08.2026).");
  }
  for (const e of events) {
    const p = e.payload ?? {};
    if (e.type === "AUDIT_NICK_ENTERED") {
      console.log(`  ${msk(e.createdAt)}  ⌨️  ввёл ник «${p.nick}»  (${p.via ?? "—"})`);
    } else {
      const owner = p.creatorName ? `, владелец по Roblox: ${p.creatorName}` : "";
      const price = p.price ? `, ${p.price} R$` : "";
      console.log(`  ${msk(e.createdAt)}  🎮  прислал геймпасс ${p.gamepassId}${owner}${price}  (${p.via ?? "—"})`);
    }
  }

  if (o.adminNote) {
    console.log("\n── Заметка менеджера ──");
    console.log(o.adminNote.split("\n").map((l) => "  " + l).join("\n"));
  }

  // Главный довод спора: адрес назначения выбирает присланный геймпасс, а не
  // слова покупателя — робуксы за пасс уходят его создателю.
  if (o.gamepassId) {
    console.log(`\n── Проверить владельца пасса ──`);
    console.log(`  https://www.roblox.com/game-pass/${o.gamepassId}`);
    console.log(`  Робуксы за геймпасс уходят его создателю — другого адреса у них быть не могло.`);
  }
}

await client.end();
console.log("");
