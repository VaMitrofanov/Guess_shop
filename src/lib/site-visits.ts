import "server-only";
import { prisma } from "@/lib/prisma";

/* 📊 Посетители сайта (18.11.2026): своя аналитика из `PerformanceSample`
   (surface = "site-visit", metric = "<устройство>:<источник>", rating = встроенный
   браузер, fingerprint = анонимный id). Один заход в базу на срез. */

export type VisitSlice = { key: string; visits: number; visitors: number };
export type VisitReport = {
  days: number;
  visits: number;
  visitors: number;
  device: VisitSlice[];
  app: VisitSlice[];
  ref: VisitSlice[];
  routes: VisitSlice[];
  daily: VisitSlice[];
};

export async function loadVisitReport(days: number): Promise<VisitReport> {
  const since = new Date(Date.now() - days * 86_400_000);
  type Row = { dim: string; key: string; visits: number; visitors: number };
  const rows = await prisma.$queryRaw<Row[]>`
    WITH v AS (
      SELECT split_part(metric, ':', 1) AS device, split_part(metric, ':', 2) AS ref, rating AS app, route, fingerprint AS who,
             to_char("createdAt" AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') AS day
      FROM "PerformanceSample" WHERE surface = 'site-visit' AND "createdAt" >= ${since}
    )
    SELECT 'all' AS dim, 'all' AS key, count(*)::int AS visits, count(DISTINCT who)::int AS visitors FROM v
    UNION ALL SELECT 'device', device, count(*)::int, count(DISTINCT who)::int FROM v GROUP BY device
    UNION ALL SELECT 'app', app, count(*)::int, count(DISTINCT who)::int FROM v GROUP BY app
    UNION ALL SELECT 'ref', ref, count(*)::int, count(DISTINCT who)::int FROM v GROUP BY ref
    UNION ALL SELECT 'route', route, count(*)::int, count(DISTINCT who)::int FROM v GROUP BY route
    UNION ALL SELECT 'day', day, count(*)::int, count(DISTINCT who)::int FROM v GROUP BY day
  `;
  const pick = (dim: string) => rows.filter((r) => r.dim === dim).map(({ key, visits, visitors }) => ({ key, visits, visitors }))
    .sort((a, b) => (dim === "day" ? a.key.localeCompare(b.key) : b.visitors - a.visitors));
  const all = rows.find((r) => r.dim === "all");
  return {
    days, visits: all?.visits ?? 0, visitors: all?.visitors ?? 0,
    device: pick("device"), app: pick("app"), ref: pick("ref"), routes: pick("route").slice(0, 12), daily: pick("day"),
  };
}
