import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { getStats30d } from "@/lib/wb-api";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [stats, codes, wbOrders] = await Promise.all([
    getStats30d(),
    (prisma as any).wbCode.groupBy({ by: ["denomination"], _count: { _all: true }, where: { isUsed: false } }),
    (prisma as any).wbOrder.count({ where: { status: { in: ["PENDING", "IN_PROGRESS"] } } }),
  ]);

  const todayStr = new Date().toISOString().split("T")[0];
  const weekAgo  = Date.now() - 7 * 864e5;
  const prevWeek = Date.now() - 14 * 864e5;

  const todayOrders  = stats?.orders.filter(o => o.date.startsWith(todayStr) && !o.isCancel) ?? [];
  const weekOrders   = stats?.orders.filter(o => new Date(o.date).getTime() >= weekAgo && !o.isCancel) ?? [];
  const prevWOrders  = stats?.orders.filter(o => { const t = new Date(o.date).getTime(); return t >= prevWeek && t < weekAgo && !o.isCancel; }) ?? [];
  const todaySales   = stats?.sales.filter(s => s.date.startsWith(todayStr)) ?? [];

  // 7-day daily breakdown
  const daily: { date: string; count: number; sum: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d   = new Date(); d.setDate(d.getDate() - i);
    const raw = d.toISOString().split("T")[0];
    const day = stats?.orders.filter(o => o.date.startsWith(raw) && !o.isCancel) ?? [];
    daily.push({ date: d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }), count: day.length, sum: day.reduce((a, o) => a + o.priceWithDisc, 0) });
  }

  return NextResponse.json({
    today:   { orders: todayOrders.length, sum: Math.round(todayOrders.reduce((a, o) => a + o.priceWithDisc, 0)), sales: todaySales.length },
    week:    { orders: weekOrders.length, sum: Math.round(weekOrders.reduce((a, o) => a + o.priceWithDisc, 0)) },
    prevWeek:{ orders: prevWOrders.length, sum: Math.round(prevWOrders.reduce((a, o) => a + o.priceWithDisc, 0)) },
    daily,
    codes: codes.sort((a: any, b: any) => a.denomination - b.denomination).map((g: any) => ({ denom: g.denomination, count: g._count._all })),
    wbOrders,
    apiAvailable: !!stats,
    tokenPresent: !!(process.env.WB_API_TOKEN),
  });
}
