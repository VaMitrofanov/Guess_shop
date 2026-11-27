#!/usr/bin/env node
/**
 * 📤 Написать клиенту с аккаунта поддержки (27.11.2026).
 *   node scripts/pa-send.mjs <tgId> "текст"
 *   node scripts/pa-send.mjs status
 * Кладёт сообщение в очередь WbSyncCursor(pa-outbox); TG-бот отправит его
 * сам на ближайшем проходе pa-desk (bots/tg/pa-desk-worker.ts → flushPaOutbox).
 * Нужны PROD_SSH и PROD_PG_CONTAINER (значения — в HANDOFF.md).
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const SSH = process.env.PROD_SSH, PG = process.env.PROD_PG_CONTAINER;
if (!SSH || !PG) { console.error("Нужны PROD_SSH и PROD_PG_CONTAINER (см. HANDOFF.md)"); process.exit(1); }
const psql = (sql) => execFileSync("ssh", [SSH, `docker exec -i ${PG} psql -U rb -d robloxbank -At`], { input: sql, encoding: "utf8" }).trim();

const [tgId, ...rest] = process.argv.slice(2);
if (tgId === "status") {
  console.log(psql(`select jsonb_pretty(metadata::jsonb->'items') from "WbSyncCursor" where stream='pa-outbox';`));
  process.exit(0);
}
const text = rest.join(" ").trim();
if (!/^\d+$/.test(tgId ?? "") || !text) { console.error('node scripts/pa-send.mjs <tgId> "текст" | status'); process.exit(1); }
const item = JSON.stringify([{ id: randomUUID(), tgId, text, status: "new", at: new Date().toISOString() }]).replace(/'/g, "''");
psql(`insert into "WbSyncCursor"(stream, metadata, "updatedAt") values ('pa-outbox', jsonb_build_object('items','${item}'::jsonb), now())
  on conflict (stream) do update set metadata = jsonb_set(coalesce("WbSyncCursor".metadata::jsonb,'{}'), '{items}',
  coalesce("WbSyncCursor".metadata::jsonb->'items','[]') || '${item}'::jsonb), "updatedAt" = now();`);
console.log("В очереди. Бот отправит в течение минуты.");
