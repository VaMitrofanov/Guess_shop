import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [groups, usedToday, usedWeek] = await Promise.all([
    (prisma as any).wbCode.groupBy({ by: ["denomination"], _count: { _all: true }, where: { isUsed: false } }),
    (prisma as any).wbCode.count({ where: { isUsed: true, usedAt: { gte: new Date(new Date().setHours(0,0,0,0)) } } }),
    (prisma as any).wbCode.count({ where: { isUsed: true, usedAt: { gte: new Date(Date.now() - 7 * 864e5) } } }),
  ]);

  // 7-day activation chart
  const chart: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const start = new Date(); start.setDate(start.getDate() - i); start.setHours(0,0,0,0);
    const end   = new Date(start.getTime() + 864e5);
    const count = await (prisma as any).wbCode.count({ where: { isUsed: true, usedAt: { gte: start, lt: end } } });
    chart.push({ date: start.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }), count });
  }

  return NextResponse.json({
    inventory: groups.sort((a: any, b: any) => a.denomination - b.denomination).map((g: any) => ({ denom: g.denomination, count: g._count._all })),
    usedToday, usedWeek, chart,
  });
}
