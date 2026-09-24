import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";

function linearRegression(points: { x: number; y: number }[]) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const p of points) { sumX += p.x; sumY += p.y; sumXY += p.x * p.y; sumX2 += p.x * p.x; }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (const p of points) { ssTot += (p.y - meanY) ** 2; ssRes += (p.y - (slope * p.x + intercept)) ** 2; }
  const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
  return { slope, intercept, r2 };
}

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [dailyRows, funnelRows, periodRows] = await Promise.all([
    (prisma as any).$queryRawUnsafe(`
      SELECT DATE("createdAt" AT TIME ZONE 'Europe/Moscow') AS day,
             COUNT(*)::int AS orders,
             COALESCE(SUM(amount), 0)::int AS total_amount
      FROM "WbOrder"
      WHERE "isTest" = false AND "createdAt" >= NOW() - INTERVAL '90 days'
      GROUP BY day ORDER BY day
    `) as Promise<any[]>,

    (prisma as any).$queryRawUnsafe(`
      SELECT DATE_TRUNC('week', "createdAt" AT TIME ZONE 'Europe/Moscow')::date AS week,
             COUNT(*) FILTER (WHERE "robloxUsername" IS NOT NULL OR "probableNick" IS NOT NULL)::int AS nicks,
             COUNT(*) FILTER (WHERE "gamepassUrl" IS NOT NULL)::int AS gamepasses
      FROM "WbOrder"
      WHERE "isTest" = false AND "createdAt" >= NOW() - INTERVAL '84 days'
      GROUP BY week ORDER BY week
    `) as Promise<any[]>,

    (prisma as any).$queryRawUnsafe(`
      SELECT
        COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '7 days')::int AS orders_7d,
        COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '30 days')::int AS orders_30d,
        COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '14 days'
                           AND "createdAt" < NOW() - INTERVAL '7 days')::int AS orders_prev_7d,
        COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '60 days'
                           AND "createdAt" < NOW() - INTERVAL '30 days')::int AS orders_prev_30d,
        COALESCE(SUM(amount) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '7 days'), 0)::int AS revenue_7d,
        COALESCE(SUM(amount) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '30 days'), 0)::int AS revenue_30d
      FROM "WbOrder"
      WHERE "isTest" = false
    `) as Promise<any[]>,
  ]);

  // Fill 90-day daily series with zero-gaps
  const dailyMap = new Map<string, { orders: number; amount: number }>();
  for (const r of dailyRows) {
    const key = r.day instanceof Date ? r.day.toISOString().split("T")[0] : String(r.day);
    dailyMap.set(key, { orders: Number(r.orders), amount: Number(r.total_amount) });
  }

  const daily: { date: string; orders: number; amount: number }[] = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    const val = dailyMap.get(key);
    daily.push({ date: key, orders: val?.orders ?? 0, amount: val?.amount ?? 0 });
  }

  // Linear regression
  const points = daily.map((d, i) => ({ x: i, y: d.orders }));
  const reg = linearRegression(points);
  const direction = reg.slope > 0.1 ? "up" as const : reg.slope < -0.1 ? "down" as const : "flat" as const;

  // Trend line (historical + 90d projected)
  const trendLine: { date: string; value: number }[] = [];
  for (let i = 0; i < daily.length; i++) {
    trendLine.push({ date: daily[i].date, value: Math.max(0, Math.round(reg.slope * i + reg.intercept)) });
  }
  const lastDate = new Date(daily[daily.length - 1].date);
  const lastIdx = daily.length - 1;
  for (let d = 1; d <= 90; d++) {
    const future = new Date(lastDate);
    future.setDate(future.getDate() + d);
    trendLine.push({
      date: future.toISOString().split("T")[0],
      value: Math.max(0, Math.round(reg.slope * (lastIdx + d) + reg.intercept)),
    });
  }

  // Period metrics
  const p = periodRows[0] ?? {};
  const o7 = Number(p.orders_7d ?? 0), o30 = Number(p.orders_30d ?? 0);
  const op7 = Number(p.orders_prev_7d ?? 0), op30 = Number(p.orders_prev_30d ?? 0);
  const r7 = Number(p.revenue_7d ?? 0), r30 = Number(p.revenue_30d ?? 0);

  const growthWoW = op7 > 0 ? Math.round(((o7 / op7) - 1) * 100) : null;
  const growthMoM = op30 > 0 ? Math.round(((o30 / op30) - 1) * 100) : null;

  // Projections
  function projectTotal(days: number): number {
    let total = 0;
    for (let d = 1; d <= days; d++) total += Math.max(0, reg.slope * (lastIdx + d) + reg.intercept);
    return Math.round(total);
  }
  const avgOrderAmount = o30 > 0 ? r30 / o30 : 0;
  const proj30 = projectTotal(30), proj60 = projectTotal(60), proj90 = projectTotal(90);

  // Funnel trend
  const funnelTrend = funnelRows.map((r: any) => {
    const n = Number(r.nicks ?? 0), g = Number(r.gamepasses ?? 0);
    const wk = r.week instanceof Date ? r.week.toISOString().split("T")[0] : String(r.week);
    return { week: wk, nicks: n, gamepasses: g, conversionPct: n > 0 ? Math.round((g / n) * 100) : 0 };
  });

  return NextResponse.json({
    daily,
    trendLine,
    regression: { slope: Math.round(reg.slope * 1000) / 1000, intercept: Math.round(reg.intercept * 10) / 10, r2: Math.round(reg.r2 * 100) / 100, direction },
    metrics: {
      avgDaily7d: Math.round((o7 / 7) * 10) / 10,
      avgDaily30d: Math.round((o30 / 30) * 10) / 10,
      growthWoW, growthMoM, revenue7d: r7, revenue30d: r30,
    },
    projections: {
      orders30d: proj30, orders60d: proj60, orders90d: proj90,
      revenue30d: Math.round(proj30 * avgOrderAmount),
      revenue60d: Math.round(proj60 * avgOrderAmount),
      revenue90d: Math.round(proj90 * avgOrderAmount),
    },
    funnelTrend,
  });
}
