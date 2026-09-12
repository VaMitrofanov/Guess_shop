import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { getNmFunnel, getStocks } from "@/lib/wb-api";

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [stocks, funnel] = await Promise.all([getStocks(), getNmFunnel()]);
  if (!stocks) return NextResponse.json({ error: "WB API unavailable" }, { status: 503 });

  // The official funnel is cohort-aligned; operational /orders uses
  // lastChangeDate and makes an unreliable runway denominator.
  const avgMap = new Map<string, number>();
  if (funnel) {
    for (const item of funnel) {
      avgMap.set(item.article, item.orders / 30);
    }
  }

  const result = stocks.map(s => {
    const avg    = avgMap.get(s.article) ?? 0;
    const runway = avg > 0 ? Math.round(s.quantity / avg) : 999;
    return { ...s, avgDailySales: Math.round(avg * 10) / 10, runwayDays: runway };
  }).sort((a, b) => a.runwayDays - b.runwayDays);

  return NextResponse.json(result);
}
