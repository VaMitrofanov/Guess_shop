import "server-only";

import { prisma } from "@/lib/prisma";
import { adminCache } from "@/lib/admin-cache";
import { getAdminDashboardData, getAdminRuntimeState } from "@/lib/admin-ecosystem";
import { loadOrderSlices, moscowDayStartUtc } from "@/lib/order-slices";
import { BUYOUT_QUEUE_SQL, DIRECT_ORDER_SQL, PRIORITY_ORDER_SQL } from "@/lib/order-queue";
import { loadFirstInLine } from "@/lib/first-in-line";
import { loadOverviewFeed } from "@/lib/overview-feed";
import { loadWbDeliveryQueueSnapshot } from "@/lib/wb-delivery-workflow";
import type {
  AdminOverview,
  OverviewDiff,
  OverviewHealth,
  OverviewQueueOrder,
} from "@/types/admin-overview";

export type * from "@/types/admin-overview";

/* ─────────────────────────────────────────────────────────────────────────────
   Данные экрана «Обзор» — начала смены (этап Г1).

   Экран отвечает на два вопроса подряд и в этом порядке: **что делать в
   ближайший час** и **что случилось, пока меня не было**. Всё, что отвечает на
   третий вопрос — «как дела у бизнеса», — уезжает в витрину внизу.

   Числа НЕ пересчитываются здесь заново: очередь берётся из `loadOrderSlices()`
   тем же предикатом, что и вкладка «Выкупить» в «Заказах», доставка — из
   `loadWbDeliveryQueueSnapshot()`, витрина — из `getAdminDashboardData()`.
   Собственный SQL появляется ровно там, где такого источника нет: голова
   очереди (заказы, которые видно и можно выкупить прямо с обзора), диф с
   момента прошлого захода и склад кодов.

   Иначе «21» в обзоре и «21» в очереди разошлись бы — ровно так уже болела
   главная TWA до 30.08.
   ───────────────────────────────────────────────────────────────────────── */

/** Сколько заказов головы очереди отдаём. Экран показывает пять старейших —
 *  остальное живёт в «Заказах»; запас нужен на те, что выкупят прямо здесь. */
export const OVERVIEW_QUEUE_HEAD = 10;

/** Порог «номинал кончается»: ниже него партию пора печатать. */
const CODES_LOW_THRESHOLD = 60;

/** Heartbeat старше этого считается протухшим. Тот же порог, что в TWA. */
export const HEARTBEAT_STALE_SECONDS = 360;

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function num(value: unknown): number {
  return Number(value ?? 0);
}

/**
 * Голова очереди выкупа — то, что видно на обзоре и по чему считается нарезка.
 *
 * Предикат — общий `BUYOUT_QUEUE_SQL`, а не своя копия условий: строка,
 * выкупленная с обзора, обязана быть той же строкой, что во вкладке
 * «Выкупить». Порядок — от старейшего: смена начинается с того, кто ждёт
 * дольше всех, а не с того, кто дешевле. Выше возраста — только приоритет:
 * поднятый кнопкой «⚡ Вперёд очереди» и прямой заказ (за него клиент заплатил
 * лично и ждёт лично). Тот же порядок, что в ленте «Выкупить».
 */
const loadQueueHead = adminCache(
  async (): Promise<{ rows: OverviewQueueOrder[]; total: number }> => {
    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string;
      wbCode: string;
      robloxUsername: string | null;
      amount: number;
      lane: OverviewQueueOrder["lane"];
      status: string;
      since: Date;
      gamepassId: string | null;
      gamepassUrl: string | null;
      splitTotal: number;
      splitDone: number;
      priorityAt: Date | null;
    }>>(`
      SELECT
        o."id",
        o."wbCode",
        o."robloxUsername",
        o."amount",
        CASE
          WHEN o."orderSource" = 'WB_DBS' THEN 'WB_DBS'
          WHEN o."isDirectOrder" = true THEN 'DIRECT'
          ELSE 'WB'
        END AS "lane",
        o."status",
        COALESCE(o."pendingAt", o."createdAt") AS "since",
        o."gamepassId",
        o."gamepassUrl",
        COALESCE(g."total", 0)::int AS "splitTotal",
        COALESCE(g."done", 0)::int AS "splitDone",
        o."priorityAt"
      FROM "WbOrder" o
      LEFT JOIN (
        SELECT "orderId",
               COUNT(*)::int AS "total",
               COUNT(*) FILTER (WHERE "purchasedAt" IS NOT NULL)::int AS "done"
        FROM "WbOrderGamepass" GROUP BY "orderId"
      ) g ON g."orderId" = o."id"
      WHERE o."isTest" = false AND ${BUYOUT_QUEUE_SQL}
      ORDER BY o.${PRIORITY_ORDER_SQL}, o.${DIRECT_ORDER_SQL}, COALESCE(o."pendingAt", o."createdAt") ASC
      LIMIT ${OVERVIEW_QUEUE_HEAD}
    `);

    const total = await prisma.$queryRawUnsafe<{ n: number }[]>(`
      SELECT COUNT(*)::int AS n FROM "WbOrder" WHERE "isTest" = false AND ${BUYOUT_QUEUE_SQL}
    `);

    return {
      rows: rows.map((row) => ({
        id: row.id,
        wbCode: row.wbCode,
        robloxUsername: row.robloxUsername,
        amount: row.amount,
        gross: Math.ceil(row.amount / 0.7),
        lane: row.lane,
        status: row.status,
        since: row.since.toISOString(),
        gamepassId: row.gamepassId,
        gamepassUrl: row.gamepassUrl,
        splitTotal: row.splitTotal,
        splitDone: row.splitDone,
        priority: row.priorityAt != null,
      })),
      total: num(total[0]?.n),
    };
  },
  ["admin-overview-queue-head-v1"],
  { tags: ["admin-orders"], revalidate: 30 },
);

/** Заморозка — тихая строка, а не задача: показываем кодами, чтобы было видно,
 *  что заказ жив и выключен намеренно, а не потерян. */
const loadHeld = adminCache(
  async () => {
    const [count, rows] = await Promise.all([
      prisma.wbOrder.count({ where: { isTest: false, heldAt: { not: null } } }),
      prisma.wbOrder.findMany({
        where: { isTest: false, heldAt: { not: null } },
        orderBy: { heldAt: "desc" },
        take: 4,
        select: { wbCode: true },
      }),
    ]);
    return { count, codes: rows.map((row) => row.wbCode) };
  },
  ["admin-overview-held-v1"],
  { tags: ["admin-orders"], revalidate: 30 },
);

const loadHealth = adminCache(
  async (): Promise<Omit<OverviewHealth, "acquiring" | "calm">> => {
    const now = Date.now();
    const [heartbeatRows, outbox, codeRows] = await Promise.all([
      prisma.serviceHeartbeat.findMany({
        orderBy: { lastSeenAt: "desc" },
        take: 6,
        select: { serviceKey: true, status: true, lastSeenAt: true },
      }),
      prisma.outboxMessage.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.wbCode.groupBy({
        by: ["denomination"],
        _count: { _all: true },
        where: { isUsed: false, isTest: false },
      }),
    ]);

    const codes = codeRows
      .map((row) => ({ denom: row.denomination, count: row._count._all }))
      .sort((a, b) => a.denom - b.denom);

    const statusCount = (status: string) =>
      outbox.find((row) => row.status === status)?._count._all ?? 0;

    return {
      heartbeats: heartbeatRows.map((row) => ({
        service: row.serviceKey,
        status: row.status,
        ageSeconds: Math.max(0, Math.floor((now - row.lastSeenAt.getTime()) / 1000)),
      })),
      outboxPending: statusCount("PENDING") + statusCount("PROCESSING"),
      outboxDead: statusCount("DEAD"),
      codes,
      codesTotal: codes.reduce((sum, row) => sum + row.count, 0),
      codesLow: codes.filter((row) => row.count < CODES_LOW_THRESHOLD),
    };
  },
  ["admin-overview-health-v1"],
  { tags: ["admin-health"], revalidate: 60 },
);

/**
 * Витрина за 30 дней.
 *
 * Отдельный запрос, а не `sourceBreakdown` из дашборда: тот считает разбивку
 * по источникам за ВСЁ время, и в одной строке витрины «30 дней · 326 заказов»
 * соседствовало с «Wildberries 755» — числа из разных эпох под одной подписью.
 */
const loadShowcase30d = adminCache(
  async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ source: string; orders: number; robux: number }>>(`
      SELECT "orderSource" AS "source", COUNT(*)::int AS "orders", COALESCE(SUM(amount), 0)::int AS "robux"
      FROM "WbOrder"
      WHERE "isTest" = false AND "createdAt" >= NOW() - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 2 DESC
    `);
    return {
      sources: rows,
      orders: rows.reduce((sum, row) => sum + row.orders, 0),
      robux: rows.reduce((sum, row) => sum + row.robux, 0),
    };
  },
  ["admin-overview-showcase-30d-v1"],
  { tags: ["admin-orders"], revalidate: 300 },
);

/** Заказы и робуксы по дням за две недели — спарклайн витрины. */
const loadDaily = adminCache(
  async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ day: Date; orders: number; robux: number }>>(`
      SELECT
        date_trunc('day', "createdAt" + INTERVAL '3 hours') AS "day",
        COUNT(*)::int AS "orders",
        COALESCE(SUM(amount), 0)::int AS "robux"
      FROM "WbOrder"
      WHERE "isTest" = false AND "createdAt" >= NOW() - INTERVAL '14 days'
      GROUP BY 1 ORDER BY 1
    `);
    return rows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      orders: row.orders,
      robux: row.robux,
    }));
  },
  ["admin-overview-daily-v1"],
  { tags: ["admin-orders"], revalidate: 300 },
);

/**
 * Что изменилось с момента `since`.
 *
 * Окно приходит из отметки присутствия и у каждого админа своё, поэтому диф
 * НЕ кэшируется: кэш на общем ключе показал бы второму админу чужое окно.
 * Запросов немного и все они по индексированным датам.
 */
export async function loadOverviewDiff(since: Date): Promise<OverviewDiff> {
  const at = `TIMESTAMP '${since.toISOString().slice(0, 19).replace("T", " ")}'`;

  const [orderRows, queuedRows, doneRows, cancelled, payments, funnelRows] = await Promise.all([
    prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
      SELECT
        COUNT(*) FILTER (WHERE "createdAt" >= ${at})::int AS "arrived",
        COUNT(*) FILTER (WHERE "createdAt" >= ${at} AND "orderSource" = 'WB_DBS')::int AS "arrivedDbs",
        COUNT(*) FILTER (WHERE "createdAt" >= ${at} AND "isDirectOrder" = true)::int AS "arrivedDirect",
        COUNT(*) FILTER (WHERE "completedAt" >= ${at})::int AS "done",
        COALESCE(SUM(amount) FILTER (WHERE "completedAt" >= ${at}), 0)::int AS "doneClean",
        -- Грязные считаются по КАЖДОМУ заказу: ceil(amount / 0.7) у каждого
        -- своё, и делить общую сумму значило бы записать в расход не то число.
        COALESCE(SUM(CEIL(amount / 0.7)) FILTER (WHERE "completedAt" >= ${at}), 0)::int AS "doneGross",
        MIN("completedAt") FILTER (WHERE "completedAt" >= ${at}) AS "doneFirstAt",
        MAX("completedAt") FILTER (WHERE "completedAt" >= ${at}) AS "doneLastAt",
        COUNT(*) FILTER (WHERE status = 'ERROR' AND "updatedAt" >= ${at})::int AS "errors",
        COUNT(*) FILTER (WHERE status = 'REJECTED' AND "updatedAt" >= ${at})::int AS "rejected"
      FROM "WbOrder" WHERE "isTest" = false
    `),
    // Встали в очередь выкупа — самое полезное в дифе: именно эти заказы
    // добавились к работе. Коды показываем, чтобы их было видно поимённо.
    prisma.$queryRawUnsafe<Array<{ wbCode: string }>>(`
      SELECT "wbCode" FROM "WbOrder"
      WHERE "isTest" = false AND "pendingAt" >= ${at}
      ORDER BY "pendingAt" DESC LIMIT 8
    `),
    // Коды выкупленных: пачку смена узнаёт поимённо, а не числом «10».
    prisma.$queryRawUnsafe<Array<{ wbCode: string }>>(`
      SELECT "wbCode" FROM "WbOrder"
      WHERE "isTest" = false AND "completedAt" >= ${at}
      ORDER BY "completedAt" DESC LIMIT 12
    `),
    prisma.wbMarketplaceOrder.count({ where: { isTest: false, cancelledAt: { gte: since } } }),
    prisma.paymentAttempt.aggregate({
      where: { status: "CONFIRMED", finalizedAt: { gte: since } },
      _count: { _all: true },
      _sum: { amountKopecks: true },
    }),
    // Ники и пассы врозь: «4 события воронки» не говорит, дошло ли дело до
    // геймпасса, а именно он двигает заказ в очередь выкупа.
    prisma.orderEvent.groupBy({
      by: ["type"],
      where: {
        createdAt: { gte: since },
        type: { in: ["AUDIT_NICK_ENTERED", "AUDIT_GAMEPASS_SUBMITTED"] },
      },
      _count: { _all: true },
    }),
  ]);

  const r = orderRows[0] ?? {};
  const queuedCodes = queuedRows.map((row) => row.wbCode);
  const countOf = (type: string) =>
    funnelRows.find((row) => row.type === type)?._count._all ?? 0;
  const nicks = countOf("AUDIT_NICK_ENTERED");
  const passes = countOf("AUDIT_GAMEPASS_SUBMITTED");

  return {
    since: since.toISOString(),
    arrived: num(r.arrived),
    arrivedDbs: num(r.arrivedDbs),
    arrivedDirect: num(r.arrivedDirect),
    done: num(r.done),
    doneClean: num(r.doneClean),
    doneGross: num(r.doneGross),
    doneCodes: doneRows.map((row) => row.wbCode),
    doneFirstAt: r.doneFirstAt ? new Date(r.doneFirstAt as string).toISOString() : null,
    doneLastAt: r.doneLastAt ? new Date(r.doneLastAt as string).toISOString() : null,
    queued: queuedCodes.length,
    queuedCodes,
    errors: num(r.errors),
    rejected: num(r.rejected),
    wbCancelled: cancelled,
    paymentsConfirmed: payments._count._all,
    paymentsRubles: Math.round((payments._sum.amountKopecks ?? 0) / 100),
    funnelEvents: nicks + passes,
    funnelNicks: nicks,
    funnelPasses: passes,
    // Очередь считает вызывающий: «сколько сейчас» знает нарезка, а не диф.
    queueNow: 0,
    queueBefore: 0,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Одиннадцать загрузок — ОДНА волна.

   До 04.09.2026 экран собирался в три захода подряд: сначала отметка
   присутствия в `page.tsx`, потом девять загрузок, потом ещё две. Каждый заход
   ждал предыдущего целиком, хотя зависимость между ними ровно одна — и та не
   по данным, а по присваиванию: `diff.queueNow` берётся из `slices` уже ПОСЛЕ
   того, как обе загрузки закончились.

   С базой в Сингапуре (210 мс за round-trip, см. performance-план) каждая
   лишняя волна — это не «чуть медленнее», а честная секунда: `/admin`
   открывался 3,5 с против 0,5 с у «Заказов». Поэтому `since` принимается и
   обещанием: отметка присутствия (два запроса) больше не держит девять
   загрузок, которые про неё ничего не знают.
   ───────────────────────────────────────────────────────────────────────── */
export async function getAdminOverview(since: Date | Promise<Date>): Promise<AdminOverview> {
  const sincePromise = Promise.resolve(since);
  const [slices, dbs, queue, firstInLine, held, health, dashboard, daily, showcase30d, diff, feed] = await Promise.all([
    loadOrderSlices(),
    loadWbDeliveryQueueSnapshot().catch(() => null),
    loadQueueHead(),
    // Кэшировать нельзя: блок «Первым делом» — это ответ на нажатие ⚡ пять
    // секунд назад, и 30-секундный кэш выглядел бы как «кнопка не сработала».
    loadFirstInLine().catch(() => null),
    loadHeld(),
    loadHealth(),
    getAdminDashboardData(),
    loadDaily(),
    loadShowcase30d(),
    sincePromise.then((from) => loadOverviewDiff(from)),
    // Лента не кэшируется по той же причине, что «Первым делом»: она и есть
    // ответ на «что случилось минуту назад».
    sincePromise.then((from) => loadOverviewFeed(from)).catch(() => [] as Awaited<ReturnType<typeof loadOverviewFeed>>),
  ]);
  const runtime = getAdminRuntimeState();

  /* Очередь «было → стало» — единственное число, которое отвечает, полегчало
     ли за смену. Считается из того, что уже посчитано: сколько стоит сейчас,
     плюс выкупленное за окно, минус вставшее в очередь за окно. */
  const queueNow = slices.slices.BUYOUT?.orders ?? 0;
  diff.queueNow = queueNow;
  diff.queueBefore = Math.max(0, queueNow + diff.done - diff.queued);

  const staleHeartbeat = health.heartbeats.some(
    (beat) => beat.status !== "HEALTHY" || beat.ageSeconds > HEARTBEAT_STALE_SECONDS,
  );

  return {
    now: new Date().toISOString(),
    slices,
    dbs,
    queue: queue.rows,
    queueTotal: queue.total,
    firstInLine,
    feed,
    held,
    diff,
    health: {
      ...health,
      acquiring: runtime.acquiring,
      calm:
        !staleHeartbeat &&
        health.outboxDead === 0 &&
        health.outboxPending === 0 &&
        health.codesLow.length === 0 &&
        runtime.acquiring !== "off",
    },
    showcase: {
      orders30d: showcase30d.orders,
      robux30d: showcase30d.robux,
      sources: showcase30d.sources,
      users: dashboard.metrics.users,
      users30d: dashboard.metrics.users30d,
      netKopecks30d: dashboard.metrics.netKopecks30d,
      paidPayments30d: dashboard.metrics.paidPayments30d,
      daily,
    },
  };
}

/** Начало сегодняшнего дня по Москве — общий помощник экрана. */
export { moscowDayStartUtc, iso };
