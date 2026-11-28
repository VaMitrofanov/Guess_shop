#!/usr/bin/env node
/**
 * 💡 Очередь «Фичи и баги» (27.11.2026) — для разработки.
 *
 *   node scripts/ideas.mjs                 # открытые задачи
 *   node scripts/ideas.mjs all             # все
 *   node scripts/ideas.mjs show 5          # задача #5 целиком, с уточнениями
 *   node scripts/ideas.mjs start 5         # «🛠 Взяли в работу» в теме
 *   node scripts/ideas.mjs done 5 "что сделано"
 *   node scripts/ideas.mjs reject 5 "почему нет"
 *
 * Читает и пишет прод-базу через ssh + psql в контейнере Postgres.
 * Нужны PROD_SSH и PROD_PG_CONTAINER в окружении (значения — в HANDOFF.md).
 * Объявление в теме делает TG-бот в течение минуты (bots/tg/ideas-worker.ts).
 */
import { execFileSync } from "node:child_process";

const SSH = process.env.PROD_SSH;
const PG = process.env.PROD_PG_CONTAINER;
if (!SSH || !PG) {
  console.error("Нужны PROD_SSH и PROD_PG_CONTAINER (см. HANDOFF.md)");
  process.exit(1);
}

const psql = (sql) =>
  execFileSync("ssh", [SSH, `docker exec -i ${PG} psql -U rb -d robloxbank -At`], { input: sql, encoding: "utf8" }).trim();
const load = () =>
  JSON.parse(psql(`select coalesce(metadata::jsonb->'items','[]') from "WbSyncCursor" where stream='admin-ideas';`) || "[]");

const [cmd = "list", nArg, ...rest] = process.argv.slice(2);
const items = load();
const OPEN = new Set(["new", "queued", "in_progress"]);

if (cmd === "list" || cmd === "all") {
  for (const i of items.filter((x) => cmd === "all" || OPEN.has(x.status))) {
    const head = i.title ?? i.text.slice(0, 80).replace(/\s+/g, " ");
    console.log(`#${i.n ?? "?"} [${i.status}] ${i.kind ?? ""} ${head}  · ${i.from} ${i.at.slice(0, 10)}${i.photo ? " 📷" : ""}${i.notes?.length ? ` ✍${i.notes.length}` : ""}`);
  }
} else if (cmd === "show") {
  const i = items.find((x) => x.n === Number(nArg));
  if (!i) { console.error("нет такой"); process.exit(1); }
  console.log(JSON.stringify(i, null, 2));
} else if (["start", "done", "reject"].includes(cmd)) {
  const n = Number(nArg);
  if (!Number.isInteger(n) || !items.some((x) => x.n === n)) { console.error("нет такой"); process.exit(1); }
  const status = { start: "in_progress", done: "done", reject: "rejected" }[cmd];
  const result = rest.join(" ").trim() || null;
  const patch = JSON.stringify({ status, result, statusAt: new Date().toISOString() }).replace(/'/g, "''");
  psql(`update "WbSyncCursor" set metadata = jsonb_set(metadata::jsonb, '{items}', (
    select jsonb_agg(case when (x->>'n')::int = ${n} then x || '${patch}'::jsonb else x end order by o)
    from jsonb_array_elements(metadata::jsonb->'items') with ordinality as t(x, o))) where stream='admin-ideas';`);
  console.log(`#${n} → ${status}. Бот объявит в теме в течение минуты.`);
} else {
  console.error('list | all | show N | start N | done N "текст" | reject N "текст"');
  process.exit(1);
}
