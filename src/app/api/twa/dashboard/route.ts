import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { getFeedbackSummary, getStats30d } from "@/lib/wb-api";
import { prisma } from "@/lib/prisma";
import { getBrowserSession } from "@/lib/browser-purchase";
import { BUYOUT_LANE_SQL, BUYOUT_QUEUE_SQL, ATTENTION_BUYOUT_HOURS, NEW_CUTOFF_HOURS, STALE_LINK_DAYS } from "@/lib/order-queue";
import { NOT_HELD_SQL } from "@/lib/order-hold";
import { loadWbDeliveryQueueSnapshot } from "@/lib/wb-delivery-workflow";

/* ─────────────────────────────────────────────────────────────────────────────
   Главная TWA отвечает на один вопрос: что выкупать сейчас и сколько это стоит.

   Поэтому очередь выкупа отдаётся не одним числом, а тремя полосами по
   происхождению (ВБ / DBS / прямые) — «23 заказа» без разбивки не говорят, где
   деньги и что горит. Границы очереди берутся из `BUYOUT_QUEUE_SQL`, того же
   предиката, что и вкладка «К выкупу»: до 30.08.2026 у экранов были свои копии
   и числа расходились.

   ❄️ Заморозка вычитается из ВСЕХ счётчиков (`NOT_HELD_SQL`) и отдаётся
   отдельным полем: замороженный заказ в статусе ERROR давал «Исправить 1
   ошибку» при пустой вкладке «Ошибка».
   ───────────────────────────────────────────────────────────────────────── */

type LaneRow = {
  lane: "WB" | "WB_DBS" | "DIRECT";
  orders: number;
  clean: number;
  gross: number;
  overdue: number;
  oldestAt: Date | null;
};

type LinkRow = {
  total: number;
  stale: number;
  remindersDone: number;
  oldestAt: Date | null;
  staleOldestAt: Date | null;
};

type ErrorRow = { count: number; oldestAt: Date | null };

/**
 * Баланс донора — сетевой поход в Roblox через SG-мост с таймаутом 70 с, и он
 * стоял на критическом пути каждой загрузки главной.
 *
 * С 30.08.2026 выкуп идёт с мелких аккаунтов по 2к, и экран покрытие не
 * показывает. Функция и поле в ответе остаются (модель вернётся, когда вернётся
 * донор), но включаются явным `?donor=1`, чтобы не платить за то, чего не видно.
 */
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

  const withDonor = req.nextUrl.searchParams.get("donor") === "1";

  const [stats, codes, laneRows, linkRows, errorRows, firstError, heldCount, heldOrders, feedback, donor, dbs] = await Promise.all([
    getStats30d(),
    prisma.wbCode.groupBy({ by: ["denomination"], _count: { _all: true }, where: { isUsed: false, isTest: false } }),

    // Очередь выкупа по происхождению. `amount` в БД — чистые робуксы (то, что
    // получит клиент); грязные — цена геймпасса, которая спишется со счёта,
    // `ceil(amount / 0.7)`. Экран показывает обе, поэтому обе считаются здесь,
    // а не пересчитываются на клиенте из округлённой суммы.
    prisma.$queryRawUnsafe<LaneRow[]>(`
      SELECT
        ${BUYOUT_LANE_SQL} AS "lane",
        COUNT(*)::int AS "orders",
        COALESCE(SUM(amount), 0)::int AS "clean",
        COALESCE(SUM(CEIL(amount / 0.7)), 0)::int AS "gross",
        COUNT(*) FILTER (
          WHERE COALESCE("pendingAt", "createdAt") <= NOW() - INTERVAL '${ATTENTION_BUYOUT_HOURS} hours'
        )::int AS "overdue",
        MIN(COALESCE("pendingAt", "createdAt")) AS "oldestAt"
      FROM "WbOrder"
      WHERE "isTest" = false AND ${BUYOUT_QUEUE_SQL}
      GROUP BY 1
    `),

    // «Ждут ссылку» с выделенными висяками: бот шлёт три напоминания (3 ч, 24 ч,
    // 72 ч) и замолкает, а очередь копит заказы, по которым уже ничего не будет.
    prisma.$queryRawUnsafe<LinkRow[]>(`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "createdAt" <= NOW() - INTERVAL '${STALE_LINK_DAYS} days')::int AS "stale",
        COUNT(*) FILTER (WHERE "remindersSent" >= 3)::int AS "remindersDone",
        MIN("createdAt") AS "oldestAt",
        MIN("createdAt") FILTER (WHERE "createdAt" <= NOW() - INTERVAL '${STALE_LINK_DAYS} days') AS "staleOldestAt"
      FROM "WbOrder"
      WHERE "isTest" = false AND "isFavorite" = false AND ${NOT_HELD_SQL}
        AND status = 'AWAITING_GAMEPASS'
        AND "createdAt" <= NOW() - INTERVAL '${NEW_CUTOFF_HOURS} hours'
    `),

    prisma.$queryRawUnsafe<ErrorRow[]>(`
      SELECT COUNT(*)::int AS "count", MIN("createdAt") AS "oldestAt"
      FROM "WbOrder"
      WHERE "isTest" = false AND "isFavorite" = false AND ${NOT_HELD_SQL} AND status = 'ERROR'
    `),

    prisma.wbOrder.findFirst({
      where: { isTest: false, isFavorite: false, status: "ERROR", heldAt: null },
      orderBy: { createdAt: "asc" },
      select: { buyoutErrorCode: true, adminNote: true },
    }),

    // Заморозка — тихая строка, а не задача: её показывают кодами, чтобы было
    // видно, что заказ жив и намеренно выключен, а не потерян. Кодов берём
    // четыре — строка на телефоне всё равно не покажет больше.
    prisma.wbOrder.count({ where: { isTest: false, heldAt: { not: null } } }),
    prisma.wbOrder.findMany({
      where: { isTest: false, heldAt: { not: null } },
      orderBy: { heldAt: "desc" },
      take: 4,
      select: { wbCode: true },
    }),

    getFeedbackSummary(),
    withDonor ? getDonorSnapshot() : Promise.resolve({ available: false, accountName: null, balance: null }),
    loadWbDeliveryQueueSnapshot().catch(() => null),
  ]);

  const LANES = ["WB", "WB_DBS", "DIRECT"] as const;
  const lanes = LANES.map((id) => {
    const row = laneRows.find((candidate) => candidate.lane === id);
    return {
      id,
      orders: row?.orders ?? 0,
      clean: row?.clean ?? 0,
      gross: row?.gross ?? 0,
      overdue: row?.overdue ?? 0,
      oldestAt: row?.oldestAt?.toISOString() ?? null,
    };
  });
  const sum = (pick: (lane: typeof lanes[number]) => number) => lanes.reduce((total, lane) => total + pick(lane), 0);
  const oldestBuyout = lanes
    .map((lane) => lane.oldestAt)
    .filter((value): value is string => value !== null)
    .sort()[0] ?? null;

  const link = linkRows[0] ?? { total: 0, stale: 0, remindersDone: 0, oldestAt: null, staleOldestAt: null };
  const errors = errorRows[0] ?? { count: 0, oldestAt: null };

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

  const requiredRobux = sum(lane => lane.gross);
  const donorBalance = donor.balance;
  const donorCoverage = {
    ...donor,
    requested: withDonor,
    requiredRobux,
    covered: donorBalance === null ? null : donorBalance >= requiredRobux,
    shortfall: donorBalance === null ? null : Math.max(0, requiredRobux - donorBalance),
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
    buyout: {
      orders: sum(lane => lane.orders),
      clean: sum(lane => lane.clean),
      gross: requiredRobux,
      overdue: sum(lane => lane.overdue),
      oldestAt: oldestBuyout,
      lanes,
    },
    errors: {
      count: errors.count,
      oldestAt: errors.oldestAt?.toISOString() ?? null,
      first: firstError?.buyoutErrorCode ?? firstError?.adminNote?.split("\n")[0]?.slice(0, 90) ?? null,
    },
    awaitingLink: {
      total: link.total,
      stale: link.stale,
      remindersDone: link.remindersDone,
      oldestAt: link.oldestAt?.toISOString() ?? null,
      staleOldestAt: link.staleOldestAt?.toISOString() ?? null,
    },
    held: {
      count: heldCount,
      codes: heldOrders.map(order => order.wbCode),
    },
    donorCoverage,
    inbox,
    dbs,
    apiAvailable: !!stats,
    tokenPresent: !!(process.env.WB_API_TOKEN),
  });
}
