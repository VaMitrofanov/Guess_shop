/**
 * 📊 «Где мои робуксы?» — сколько вопросов бот закрыл сам, а сколько дошло до
 * менеджера. По неделям (понедельник, МСК). События пишет
 * `bots/shared/support-metric.ts` с 24.10.2026; чат WB — `ROBUX_ETA_ANSWERED`
 * с 23.10.2026.
 *
 *   node --import tsx scripts/robux-question-metric.ts            # 8 недель
 *   node --import tsx scripts/robux-question-metric.ts --weeks 12
 *
 * Только чтение.
 */
import "dotenv/config";
import { Pool } from "pg";

const args = process.argv.slice(2);
const weeksArg = Number(args[args.indexOf("--weeks") + 1]);
const weeks = args.includes("--weeks") && Number.isFinite(weeksArg) && weeksArg > 0 ? Math.min(weeksArg, 52) : 8;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SQL = `
WITH ev AS (
  SELECT date_trunc('week', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow') AS week,
         type, payload
    FROM "OrderEvent"
   WHERE type IN ('ROBUX_QUESTION_SELF_SERVED', 'SUPPORT_REQUEST_DELIVERED')
     AND "createdAt" > NOW() - ($1 || ' weeks')::interval
  UNION ALL
  SELECT date_trunc('week', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow'),
         'ROBUX_QUESTION_SELF_SERVED', jsonb_build_object('via', 'wb-chat', 'kind', 'eta')
    FROM "WbMarketplaceEvent"
   WHERE type = 'ROBUX_ETA_ANSWERED'
     AND "createdAt" > NOW() - ($1 || ' weeks')::interval
)
SELECT to_char(week, 'DD.MM') AS week,
       COUNT(*) FILTER (WHERE type = 'ROBUX_QUESTION_SELF_SERVED')                                  AS self_served,
       COUNT(*) FILTER (WHERE type = 'ROBUX_QUESTION_SELF_SERVED' AND payload->>'kind' = 'stage')   AS by_stage,
       COUNT(*) FILTER (WHERE type = 'SUPPORT_REQUEST_DELIVERED' AND (payload->>'robux')::boolean)  AS to_manager_robux,
       COUNT(*) FILTER (WHERE type = 'SUPPORT_REQUEST_DELIVERED')                                   AS to_manager_all
  FROM ev
 GROUP BY week
 ORDER BY week`;

async function main() {
  const { rows } = await pool.query(SQL, [String(weeks)]);
  console.log("неделя  бот сам  (этап)  менеджеру: про робуксы / всего   доля робуксов, ушедших к менеджеру");
  for (const r of rows) {
    const self = Number(r.self_served);
    const robux = Number(r.to_manager_robux);
    const share = self + robux > 0 ? `${Math.round((robux / (self + robux)) * 100)} %` : "—";
    console.log(
      `${r.week}   ${String(self).padStart(6)}  ${String(r.by_stage).padStart(6)}   ${String(robux).padStart(8)} / ${String(r.to_manager_all).padEnd(6)}   ${share}`,
    );
  }
  if (rows.length === 0) console.log("событий пока нет");
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => pool.end());
