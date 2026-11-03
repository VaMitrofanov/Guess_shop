import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { getFeedbackSummary, getStats30d } from "@/lib/wb-api";
import { prisma } from "@/lib/prisma";
import { getBrowserSession } from "@/lib/browser-purchase";
import { BUYOUT_LANE_SQL, BUYOUT_QUEUE_SQL, ATTENTION_BUYOUT_HOURS, NEW_CUTOFF_HOURS, SILENT_REMINDERS } from "@/lib/order-queue";
import { NOT_HELD_SQL } from "@/lib/order-hold";
import { loadFirstInLine } from "@/lib/first-in-line";
import { loadWbDeliveryQueueSnapshot } from "@/lib/wb-delivery-workflow";
import { loadOverviewDiff } from "@/lib/admin-overview";
import { loadOverviewFeed } from "@/lib/overview-feed";
import { touchAdminPresence } from "@/lib/admin-presence";

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

const PENDING = Symbol("pending");

/** Ждём не дольше `ms`; не успел — `PENDING`, а не «недоступен»: это разные вещи. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof PENDING> {
  return Promise.race([
    promise,
    new Promise<typeof PENDING>(resolve => setTimeout(() => resolve(PENDING), ms)),
  ]);
}

/* ── Ядро главной: очереди, DBS, «первым делом» ────────────────────────────
   ~16 запросов к Neon в Сингапуре (~210 мс каждый) через пул из 5 соединений —
   3–3,6 с на каждый заход и каждый 30-секундный опрос каждого админа (20.10.2026).
   Ядро одно на всех: свежее 15 с отдаётся как есть, до 2 минут — сразу, с
   обновлением в фоне; старше — ждём. «Пока вас не было» считается отдельно:
   оно своё у каждого админа. */
const CORE_FRESH_MS = 15_000;
const CORE_STALE_MS = 120_000;
let coreCache: { data: Awaited<ReturnType<typeof loadCore>>; ts: number } | null = null;
let coreInflight: Promise<Awaited<ReturnType<typeof loadCore>>> | null = null;

async function loadCore() {
  const [codes, laneRows, linkRows, errorRows, firstError, heldCount, heldOrders, dbs, firstInLine] = await Promise.all([
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
        COUNT(*) FILTER (WHERE "remindersSent" >= ${SILENT_REMINDERS})::int AS "stale",
        COUNT(*) FILTER (WHERE "remindersSent" >= 3)::int AS "remindersDone",
        MIN("createdAt") AS "oldestAt",
        MIN("createdAt") FILTER (WHERE "remindersSent" >= ${SILENT_REMINDERS}) AS "staleOldestAt"
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

    loadWbDeliveryQueueSnapshot().catch(() => null),
    // ⚡ Первым делом: поднятые руками и прямые заказы. Тот же загрузчик, что у
    // «Обзора» на сайте — иначе две главные показывали бы разные списки того,
    // что «выкупать первым».
    loadFirstInLine().catch(() => null),

  ]);
  return { codes, laneRows, linkRows, errorRows, firstError, heldCount, heldOrders, dbs, firstInLine };
}

function loadCoreCached() {
  const age = coreCache ? Date.now() - coreCache.ts : Infinity;
  if (coreCache && age < CORE_FRESH_MS) return Promise.resolve(coreCache.data);
  coreInflight ??= loadCore()
    .then(data => { coreCache = { data, ts: Date.now() }; return data; })
    .finally(() => { coreInflight = null; });
  if (coreCache && age < CORE_STALE_MS) return Promise.resolve(coreCache.data);
  return coreInflight;
}

export async function GET(req: NextRequest) {
  const twaUser = await extractTwaUser(req);
  if (!twaUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const withDonor = req.nextUrl.searchParams.get("donor") === "1";

  /* ── Смена: «Пока вас не было» ──────────────────────────────────────────
     Отметка присутствия ставится РОВНО ОДИН РАЗ — на первой загрузке экрана,
     когда клиент ещё не знает своего окна. Дальше он присылает `shiftSince`
     сам, и живой опрос раз в 30 секунд окно не двигает: иначе блок схлопывался
     бы в ноль ровно тогда, когда его читают (та же причина, что на сайте).
     Пропуск TWA выдаётся только Telegram-админу из `ADMIN_IDS`, поэтому
     присутствие пишется на тот же Telegram ID, что и на сайте: заходы с
     телефона и с ноутбука — это одна смена одного человека. */
  const sinceParam = req.nextUrl.searchParams.get("shiftSince");
  const sinceDate = sinceParam ? new Date(sinceParam) : null;
  const shiftWindow = sinceDate && Number.isFinite(sinceDate.getTime())
    ? { windowStartAt: sinceDate, firstVisit: false }
    : await touchAdminPresence({
      via: "telegram",
      telegramId: String(twaUser.userId),
      userId: null,
      displayName: twaUser.firstName || `TG ${twaUser.userId}`,
    }).catch(() => null);

  const [statsRaw, core, feedbackRaw, donor, shiftData] = await Promise.all([
    // WB API — внешний и медленный; главная его не ждёт дольше 400 мс (кэш
    // прогреется в фоне, данные придут со следующим опросом через 30 с).
    withTimeout(getStats30d().catch(() => null), 400),
    // Очереди, DBS и «первым делом» — из общего кэша (см. `loadCoreCached`).
    loadCoreCached(),
    withTimeout(getFeedbackSummary().catch(() => null), 400),
    withDonor ? getDonorSnapshot() : Promise.resolve({ available: false, accountName: null, balance: null }),
    // Смена: диф и лента считаются теми же загрузчиками, что на сайте. Телефон
    // и ноутбук обязаны показывать одну и ту же смену — расхождение здесь
    // читалось бы как «на сайте видно больше».
    shiftWindow
      ? Promise.all([
        loadOverviewDiff(shiftWindow.windowStartAt).catch(() => null),
        loadOverviewFeed(shiftWindow.windowStartAt).catch(() => []),
      ])
      : Promise.resolve(null),
  ]);
  const { codes, laneRows, linkRows, errorRows, firstError, heldCount, heldOrders, dbs, firstInLine } = core;

  const statsPending = statsRaw === PENDING;
  const stats = statsRaw === PENDING ? null : statsRaw;
  const feedback = feedbackRaw === PENDING ? null : feedbackRaw;

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

  const [shiftDiff, shiftFeed] = shiftData ?? [null, []];
  if (shiftDiff) {
    // Очередь «было → стало» знает не диф, а срез очереди: здесь он уже посчитан.
    shiftDiff.queueNow = sum(lane => lane.orders);
    shiftDiff.queueBefore = Math.max(0, shiftDiff.queueNow + shiftDiff.done - shiftDiff.queued);
  }
  const shift = shiftWindow && shiftDiff
    ? {
      since: shiftWindow.windowStartAt.toISOString(),
      firstVisit: shiftWindow.firstVisit,
      diff: shiftDiff,
      feed: shiftFeed,
    }
    : null;

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
    firstInLine,
    shift,
    donorCoverage,
    inbox,
    dbs,
    // Пока WB догружается в фоне (холодный кэш), плашку «недоступен» не
    // показываем: данные придут со следующим опросом.
    apiAvailable: statsPending || !!stats,
    tokenPresent: !!(process.env.WB_API_TOKEN),
  });
}
