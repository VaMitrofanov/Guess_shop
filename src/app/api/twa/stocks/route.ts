import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { getStats30d, getStocks } from "@/lib/wb-api";

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [stocks, stats] = await Promise.all([getStocks(), getStats30d()]);
  if (!stocks) return NextResponse.json({ error: "WB API unavailable" }, { status: 503 });

  // Compute avg daily sales per article from last 14 days
  const avgMap = new Map<string, number>();
  if (stats) {
    const cutoff = Date.now() - 14 * 864e5;
    const byArt  = new Map<string, number>();
    for (const o of stats.orders) {
      if (new Date(o.date).getTime() < cutoff || o.isCancel) continue;
      byArt.set(o.supplierArticle, (byArt.get(o.supplierArticle) ?? 0) + 1);
    }
    for (const [art, cnt] of byArt) avgMap.set(art, cnt / 14);
  }

  const result = stocks.map(s => {
    const avg    = avgMap.get(s.article) ?? 0;
    const runway = avg > 0 ? Math.round(s.quantity / avg) : 999;
    return { ...s, avgDailySales: Math.round(avg * 10) / 10, runwayDays: runway };
  }).sort((a, b) => a.runwayDays - b.runwayDays);

  return NextResponse.json(result);
}
