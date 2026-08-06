import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { getFeedbackSummary, getStats30d } from "@/lib/wb-api";
import { prisma } from "@/lib/prisma";
import { getBrowserSession } from "@/lib/browser-purchase";
import { PAID_BUYOUT_SQL } from "@/lib/buyout-queue";

type AttentionRow = {
  buyout: number;
  awaitingLink: number;
  errors: number;
  requiredRobux: number;
  oldestAt: Date | null;
};

async function getDonorSnapshot() {
  const settings = await prisma.globalSettings.findUnique({
    where: { id: "global" },
    select: { robloxCookie: true, robloxAccountName: true },
  });
  if (!settings?.robloxCookie) return { available: false, accountName: null, balance: null };
  const browser = await getBrowserSession(settings.robloxCookie);
  return {
    available: browser.ok && typeof browser.session?.balance === "number",
    accountName: browser.session?.accountName ?? settings.robloxAccountName,
    balance: browser.session?.balance ?? null,
    failureCode: browser.ok ? null : browser.code,
  };
}

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [stats, codes, attentionRows, firstError, feedback, donor] = await Promise.all([
    getStats30d(),
    prisma.wbCode.groupBy({ by: ["denomination"], _count: { _all: true }, where: { isUsed: false, isTest: false } }),
    // Очередь «К выкупу» = то же множество, что и вкладка BUYOUT в api/twa/orders:
    // оплаченный прямой заказ выкупается теми же руками, поэтому считается здесь
    // (и в «нужно робуксов»); неоплаченный прямой — вне выкупа.
    prisma.$queryRawUnsafe<AttentionRow[]>(`
      SELECT
        COUNT(*) FILTER (
          WHERE status IN ('PENDING', 'IN_PROGRESS')
            AND ${PAID_BUYOUT_SQL}
            AND "orderSource" <> 'AVITO'
        )::int AS "buyout",
        COUNT(*) FILTER (WHERE status = 'AWAITING_GAMEPASS')::int AS "awaitingLink",
        COUNT(*) FILTER (WHERE status = 'ERROR')::int AS "errors",
        COALESCE(SUM(CEIL(amount / 0.7)) FILTER (
          WHERE status IN ('PENDING', 'IN_PROGRESS')
            AND ${PAID_BUYOUT_SQL}
            AND "orderSource" <> 'AVITO'
        ), 0)::int AS "requiredRobux",
        LEAST(
          MIN(COALESCE("pendingAt", "createdAt")) FILTER (
            WHERE status IN ('PENDING', 'IN_PROGRESS')
              AND ${PAID_BUYOUT_SQL}
              AND "orderSource" <> 'AVITO'
          ),
          MIN("createdAt") FILTER (WHERE status IN ('AWAITING_GAMEPASS', 'ERROR'))
        ) AS "oldestAt"
      FROM "WbOrder"
      WHERE "isTest" = false AND "isFavorite" = false
    `),
    prisma.wbOrder.findFirst({
      where: { isTest: false, isFavorite: false, status: "ERROR" },
      orderBy: { createdAt: "asc" },
      select: { buyoutErrorCode: true, adminNote: true },
    }),
    getFeedbackSummary(),
    getDonorSnapshot(),
  ]);
  const attention = attentionRows[0] ?? { buyout: 0, awaitingLink: 0, errors: 0, requiredRobux: 0, oldestAt: null };

  const todayStr = new Date().toISOString().split("T")[0];
  const weekAgo  = Date.now() - 7 * 864e5;
  const prevWeek = Date.now() - 14 * 864e5;

  const todayOrders  = stats?.orders.filter(o => o.date.startsWith(todayStr) && !o.isCancel) ?? [];
  const weekOrders   = stats?.orders.filter(o => new Date(o.date).getTime() >= weekAgo && !o.isCancel) ?? [];
  const prevWOrders  = stats?.orders.filter(o => { const t = new Date(o.date).getTime(); return t >= prevWeek && t < weekAgo && !o.isCancel; }) ?? [];
  const todaySales   = stats?.sales.filter(s => s.date.startsWith(todayStr)) ?? [];
  const inbox = {
    available: feedback !== null,
    feedbacks: feedback?.unansweredFeedbacks ?? 0,
    questions: feedback?.unansweredQuestions ?? 0,
    total: (feedback?.unansweredFeedbacks ?? 0) + (feedback?.unansweredQuestions ?? 0),
  };
  const donorBalance = donor.balance;
  const donorCoverage = {
    ...donor,
    requiredRobux: attention.requiredRobux,
    covered: donorBalance === null ? null : donorBalance >= attention.requiredRobux,
    shortfall: donorBalance === null ? null : Math.max(0, attention.requiredRobux - donorBalance),
  };

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
    codes: codes.sort((a, b) => a.denomination - b.denomination).map(g => ({ denom: g.denomination, count: g._count._all })),
    attention: {
      total: attention.buyout + attention.awaitingLink + attention.errors + inbox.total,
      buyout: attention.buyout,
      awaitingLink: attention.awaitingLink,
      errors: attention.errors,
      oldestAt: attention.oldestAt?.toISOString() ?? null,
      firstError: firstError?.buyoutErrorCode ?? firstError?.adminNote?.split("\n")[0]?.slice(0, 90) ?? null,
    },
    donorCoverage,
    inbox,
    apiAvailable: !!stats,
    tokenPresent: !!(process.env.WB_API_TOKEN),
  });
}
