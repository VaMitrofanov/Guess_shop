import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { adminCache } from "@/lib/admin-cache";
import { logAdminTiming } from "@/lib/admin-performance";
import { isSiteAcquiringEnabled, parseSiteAcquiringMode } from "@/lib/site-acquiring";

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

export type AdminOrderRow = {
  id: string;
  code: string;
  publicOrderId: string | null;
  source: string;
  platform: string;
  status: string;
  amountRobux: number;
  robloxUsername: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  completedAt: string | null;
  client: {
    name: string | null;
    username: string | null;
    email: string | null;
  };
  payment: {
    id: string;
    status: string;
    amountKopecks: number;
    refundedAmountKopecks: number;
    updatedAt: string;
  } | null;
  attention: boolean;
};

export type AdminOrdersFilter = "ALL" | "SITE" | "WB" | "WB_DBS" | "DIRECT" | "AVITO" | "ERROR";

export type AdminOrdersPage = {
  orders: AdminOrderRow[];
  nextCursor: string | null;
};

function serializeOrder(order: {
  id: string;
  wbCode: string;
  publicOrderId: string | null;
  orderSource: string;
  platform: string;
  status: string;
  amount: number;
  robloxUsername: string | null;
  probableNick: string | null;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
  completedAt: Date | null;
  user: { name: string | null; username: string | null; email: string | null };
  paymentAttempts: Array<{
    id: string;
    status: string;
    amountKopecks: number;
    refundedAmountKopecks: number;
    updatedAt: Date;
  }>;
}): AdminOrderRow {
  const payment = order.paymentAttempts[0];
  return {
    id: order.id,
    code: order.publicOrderId ?? order.wbCode,
    publicOrderId: order.publicOrderId,
    source: order.orderSource,
    platform: order.platform,
    status: order.status,
    amountRobux: order.amount,
    robloxUsername: order.robloxUsername ?? order.probableNick,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    paidAt: iso(order.paidAt),
    completedAt: iso(order.completedAt),
    client: order.user,
    payment: payment ? {
      id: payment.id,
      status: payment.status,
      amountKopecks: payment.amountKopecks,
      refundedAmountKopecks: payment.refundedAmountKopecks,
      updatedAt: payment.updatedAt.toISOString(),
    } : null,
    attention:
      order.status === "ERROR" ||
      payment?.status === "FAILED" ||
      (order.orderSource === "SITE" && order.status === "PENDING" && !order.paidAt),
  };
}

const orderListInclude = {
  user: { select: { name: true, username: true, email: true } },
  paymentAttempts: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: {
      id: true,
      status: true,
      amountKopecks: true,
      refundedAmountKopecks: true,
      updatedAt: true,
    },
  },
};

export async function getAdminOrders(limit = 250): Promise<AdminOrderRow[]> {
  const orders = await prisma.wbOrder.findMany({
    where: { isTest: false },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    include: orderListInclude,
  });
  return orders.map(serializeOrder);
}

function encodeOrderCursor(value: { createdAt: Date; id: string }) {
  return Buffer.from(JSON.stringify({ createdAt: value.createdAt.toISOString(), id: value.id }))
    .toString("base64url");
}

function decodeOrderCursor(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof value.createdAt !== "string" || typeof value.id !== "string") return null;
    const createdAt = new Date(value.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || !/^[a-z0-9_-]{8,40}$/i.test(value.id)) return null;
    return { createdAt, id: value.id };
  } catch {
    return null;
  }
}

export async function getAdminOrdersPage(input: {
  query?: string;
  filter?: AdminOrdersFilter;
  cursor?: string | null;
  limit?: number;
} = {}): Promise<AdminOrdersPage> {
  const query = input.query?.trim().slice(0, 120) ?? "";
  const filter = input.filter ?? "ALL";
  const cursor = decodeOrderCursor(input.cursor);
  const limit = Math.min(100, Math.max(10, input.limit ?? 50));
  const clauses: Prisma.WbOrderWhereInput[] = [{ isTest: false }];

  if (["SITE", "WB", "WB_DBS", "DIRECT", "AVITO"].includes(filter)) {
    clauses.push({ orderSource: filter as "SITE" | "WB" | "WB_DBS" | "DIRECT" | "AVITO" });
  } else if (filter === "ERROR") {
    clauses.push({
      OR: [
        { status: "ERROR" },
        { paymentAttempts: { some: { status: "FAILED" } } },
        { orderSource: "SITE", status: "PENDING", paidAt: null },
      ],
    });
  }

  if (query) {
    clauses.push({
      OR: [
        { wbCode: { contains: query, mode: "insensitive" } },
        { publicOrderId: { contains: query, mode: "insensitive" } },
        { robloxUsername: { contains: query, mode: "insensitive" } },
        { probableNick: { contains: query, mode: "insensitive" } },
        { user: { is: { name: { contains: query, mode: "insensitive" } } } },
        { user: { is: { username: { contains: query, mode: "insensitive" } } } },
        { user: { is: { email: { contains: query, mode: "insensitive" } } } },
      ],
    });
  }

  if (cursor) {
    clauses.push({
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    });
  }

  const rows = await prisma.wbOrder.findMany({
    where: { AND: clauses },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: orderListInclude,
  });
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    orders: visible.map(serializeOrder),
    nextCursor: hasMore && last ? encodeOrderCursor(last) : null,
  };
}

type OperationalSnapshotRow = {
  totalOrders: bigint;
  activeOrders: bigint;
  buyoutOrders: bigint;
  created24h: bigint;
  completed24h: bigint;
  errorOrders: bigint;
  users: bigint;
  users30d: bigint;
  openPayments: bigint;
  deadOutbox: bigint;
  pendingOutbox: bigint;
  unknownRefunds: bigint;
  uniqueBuyers: bigint;
  repeatBuyers: bigint;
  availableCodes: bigint;
  reservedCodes: bigint;
  expiredReservedCodes: bigint;
};

type FinanceSnapshotRow = {
  completedOrders: bigint;
  orders30d: bigint;
  completedRobux: bigint;
  paidPayments: bigint;
  grossKopecks: bigint;
  refundedKopecks: bigint;
  paidPayments30d: bigint;
  grossKopecks30d: bigint;
  refundedKopecks30d: bigint;
  source: string | null;
  sourceOrders: bigint | null;
  sourceRobux: bigint | null;
};

type OperationalSnapshot = { [Key in keyof OperationalSnapshotRow]: number };
type FinanceSnapshot = {
  completedOrders: number;
  orders30d: number;
  completedRobux: number;
  paidPayments: number;
  grossKopecks: number;
  refundedKopecks: number;
  paidPayments30d: number;
  grossKopecks30d: number;
  refundedKopecks30d: number;
  source: string | null;
  sourceOrders: number;
  sourceRobux: number;
};

function serializeOperationalSnapshot(row: OperationalSnapshotRow): OperationalSnapshot {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value)]),
  ) as OperationalSnapshot;
}

function serializeFinanceSnapshot(row: FinanceSnapshotRow): FinanceSnapshot {
  return {
    completedOrders: Number(row.completedOrders),
    orders30d: Number(row.orders30d),
    completedRobux: Number(row.completedRobux),
    paidPayments: Number(row.paidPayments),
    grossKopecks: Number(row.grossKopecks),
    refundedKopecks: Number(row.refundedKopecks),
    paidPayments30d: Number(row.paidPayments30d),
    grossKopecks30d: Number(row.grossKopecks30d),
    refundedKopecks30d: Number(row.refundedKopecks30d),
    source: row.source,
    sourceOrders: Number(row.sourceOrders ?? 0),
    sourceRobux: Number(row.sourceRobux ?? 0),
  };
}

async function queryDashboardOperational() {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<OperationalSnapshotRow[]>(Prisma.sql`
    WITH order_stats AS (
      SELECT
        COUNT(*) AS "totalOrders",
        COUNT(*) FILTER (WHERE "status"::text IN ('AWAITING_PAYMENT', 'PAYMENT_PENDING', 'AWAITING_GAMEPASS', 'PENDING', 'IN_PROGRESS')) AS "activeOrders",
        COUNT(*) FILTER (
          WHERE "isFavorite" = false
            AND "orderSource"::text <> 'AVITO'
            AND NOT ("isDirectOrder" = true AND "paidAt" IS NULL)
            AND (
              "status"::text IN ('PENDING', 'IN_PROGRESS')
              OR ("status"::text = 'ERROR' AND "buyoutErrorCode" IN ('REGIONAL_PRICE', 'ROBLOX_PLUS_FLOW'))
            )
        ) AS "buyoutOrders",
        COUNT(*) FILTER (WHERE "createdAt" >= ${since24h}) AS "created24h",
        COUNT(*) FILTER (WHERE "completedAt" >= ${since24h}) AS "completed24h",
        COUNT(*) FILTER (WHERE "status"::text = 'ERROR') AS "errorOrders"
      FROM "WbOrder"
      WHERE "isTest" = false
    ),
    buyer_stats AS (
      SELECT COUNT(*) AS "uniqueBuyers", COUNT(*) FILTER (WHERE orders > 1) AS "repeatBuyers"
      FROM (
        SELECT "userId", COUNT(*) AS orders
        FROM "WbOrder"
        WHERE "isTest" = false
        GROUP BY "userId"
      ) buyers
    ),
    user_stats AS (
      SELECT COUNT(*) AS users, COUNT(*) FILTER (WHERE "createdAt" >= ${since30d}) AS "users30d"
      FROM "User"
    ),
    payment_stats AS (
      SELECT COUNT(*) FILTER (WHERE p."status"::text IN ('CREATED', 'INITIATED', 'AUTHORIZED')) AS "openPayments"
      FROM "PaymentAttempt" p
      JOIN "WbOrder" o ON o.id = p."orderId"
      WHERE o."isTest" = false
    ),
    outbox_stats AS (
      SELECT
        COUNT(*) FILTER (WHERE "status"::text = 'DEAD') AS "deadOutbox",
        COUNT(*) FILTER (WHERE "status"::text IN ('PENDING', 'PROCESSING')) AS "pendingOutbox"
      FROM "OutboxMessage"
    ),
    refund_stats AS (
      SELECT COUNT(*) FILTER (WHERE r."status"::text = 'SUBMIT_UNKNOWN') AS "unknownRefunds"
      FROM "PaymentRefund" r
      JOIN "PaymentAttempt" p ON p.id = r."paymentAttemptId"
      JOIN "WbOrder" o ON o.id = p."orderId"
      WHERE o."isTest" = false
    ),
    code_stats AS (
      SELECT
        COUNT(*) FILTER (WHERE "status"::text = 'AVAILABLE') AS "availableCodes",
        COUNT(*) FILTER (
          WHERE "status"::text = 'RESERVED' AND "reservedUntil" > NOW()
        ) AS "reservedCodes",
        COUNT(*) FILTER (
          WHERE "status"::text = 'RESERVED' AND ("reservedUntil" IS NULL OR "reservedUntil" <= NOW())
        ) AS "expiredReservedCodes"
      FROM "WbCode"
    )
    SELECT os.*, bs.*, us.*, ps.*, outs.*, rs.*, cs.*
    FROM order_stats os
    CROSS JOIN buyer_stats bs
    CROSS JOIN user_stats us
    CROSS JOIN payment_stats ps
    CROSS JOIN outbox_stats outs
    CROSS JOIN refund_stats rs
    CROSS JOIN code_stats cs
  `);
  return rows[0] ? serializeOperationalSnapshot(rows[0]) : null;
}

async function queryDashboardFinance() {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<FinanceSnapshotRow[]>(Prisma.sql`
    WITH order_stats AS (
      SELECT
        COUNT(*) FILTER (WHERE "status"::text = 'COMPLETED') AS "completedOrders",
        COUNT(*) FILTER (WHERE "createdAt" >= ${since30d}) AS "orders30d",
        COALESCE(SUM("amount") FILTER (WHERE "status"::text = 'COMPLETED'), 0) AS "completedRobux"
      FROM "WbOrder"
      WHERE "isTest" = false
    ),
    payment_stats AS (
      SELECT
        COUNT(*) AS "paidPayments",
        COALESCE(SUM(p."amountKopecks"), 0) AS "grossKopecks",
        COALESCE(SUM(p."refundedAmountKopecks"), 0) AS "refundedKopecks",
        COUNT(*) FILTER (WHERE p."finalizedAt" >= ${since30d}) AS "paidPayments30d",
        COALESCE(SUM(p."amountKopecks") FILTER (WHERE p."finalizedAt" >= ${since30d}), 0) AS "grossKopecks30d",
        COALESCE(SUM(p."refundedAmountKopecks") FILTER (WHERE p."finalizedAt" >= ${since30d}), 0) AS "refundedKopecks30d"
      FROM "PaymentAttempt" p
      JOIN "WbOrder" o ON o.id = p."orderId"
      WHERE o."isTest" = false
        AND p."status"::text IN ('CONFIRMED', 'PARTIALLY_REFUNDED', 'REFUNDED')
    ),
    source_rows AS (
      SELECT "orderSource"::text AS source, COUNT(*) AS orders, COALESCE(SUM("amount"), 0) AS robux
      FROM "WbOrder"
      WHERE "isTest" = false
      GROUP BY "orderSource"
    )
    SELECT
      os.*,
      ps.*,
      sr.source,
      sr.orders AS "sourceOrders",
      sr.robux AS "sourceRobux"
    FROM order_stats os
    CROSS JOIN payment_stats ps
    LEFT JOIN source_rows sr ON true
  `);
  return rows.map(serializeFinanceSnapshot);
}

const loadDashboardOperational = adminCache(
  queryDashboardOperational,
  ["admin-dashboard-operational-v2"],
  { tags: ["admin-operational"], revalidate: 10 },
);

const loadDashboardFinance = adminCache(
  queryDashboardFinance,
  ["admin-dashboard-finance-v2"],
  { tags: ["admin-finance"], revalidate: 60 },
);

const loadDashboardRecent = adminCache(
  async () => {
    const rows = await prisma.wbOrder.findMany({
      where: { isTest: false },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 8,
      include: orderListInclude,
    });
    return rows.map(serializeOrder);
  },
  ["admin-dashboard-recent-v2"],
  { tags: ["admin-operational"], revalidate: 10 },
);

const loadDashboardHeartbeats = adminCache(
  async () => {
    const rows = await prisma.serviceHeartbeat.findMany({
      orderBy: { lastSeenAt: "desc" },
      take: 6,
      select: { serviceKey: true, status: true, lastSeenAt: true, lastAlertAt: true },
    });
    return rows.map((row) => ({
      serviceKey: row.serviceKey,
      status: row.status,
      lastSeenAt: row.lastSeenAt.toISOString(),
      lastAlertAt: iso(row.lastAlertAt),
    }));
  },
  ["admin-dashboard-heartbeats-v2"],
  { tags: ["admin-operational"], revalidate: 10 },
);

export async function getAdminDashboardData() {
  const startedAt = performance.now();
  const now = new Date();
  const [operational, financeRows, recentRows, heartbeatRows] = await Promise.all([
    loadDashboardOperational(),
    loadDashboardFinance(),
    loadDashboardRecent(),
    loadDashboardHeartbeats(),
  ]);
  if (!operational || financeRows.length === 0) {
    throw new Error("Admin dashboard aggregate returned no rows");
  }

  const finance = financeRows[0];
  const totalOrders = operational.totalOrders;
  const paidPayments = finance.paidPayments;
  const grossKopecks = finance.grossKopecks;
  const refundedKopecks = finance.refundedKopecks;
  const grossKopecks30d = finance.grossKopecks30d;
  const refundedKopecks30d = finance.refundedKopecks30d;

  const result = {
    metrics: {
      totalOrders,
      activeOrders: operational.activeOrders,
      buyoutOrders: operational.buyoutOrders,
      created24h: operational.created24h,
      completed24h: operational.completed24h,
      completedOrders: finance.completedOrders,
      orders30d: finance.orders30d,
      users: operational.users,
      users30d: operational.users30d,
      uniqueBuyers: operational.uniqueBuyers,
      repeatBuyers: operational.repeatBuyers,
      paidPayments,
      averagePaidKopecks: paidPayments > 0 ? Math.round(grossKopecks / paidPayments) : 0,
      grossKopecks,
      refundedKopecks,
      netKopecks: grossKopecks - refundedKopecks,
      paidPayments30d: finance.paidPayments30d,
      grossKopecks30d,
      refundedKopecks30d,
      netKopecks30d: grossKopecks30d - refundedKopecks30d,
      completedRobux: finance.completedRobux,
      attention: operational.errorOrders + operational.deadOutbox + operational.unknownRefunds,
      errorOrders: operational.errorOrders,
      openPayments: operational.openPayments,
      deadOutbox: operational.deadOutbox,
      pendingOutbox: operational.pendingOutbox,
      unknownRefunds: operational.unknownRefunds,
      availableCodes: operational.availableCodes,
      reservedCodes: operational.reservedCodes,
      expiredReservedCodes: operational.expiredReservedCodes,
    },
    sourceBreakdown: financeRows
      .filter((row) => row.source !== null)
      .map((row) => ({
        source: row.source as string,
        orders: row.sourceOrders,
        robux: row.sourceRobux,
      }))
      .sort((a, b) => b.orders - a.orders),
    heartbeats: heartbeatRows.map((row) => ({
      service: row.serviceKey,
      status: row.status,
      lastSeenAt: row.lastSeenAt,
      lastAlertAt: row.lastAlertAt,
      ageSeconds: Math.max(0, Math.floor((now.getTime() - Date.parse(row.lastSeenAt)) / 1000)),
    })),
    recentOrders: recentRows,
  };
  logAdminTiming("dashboard", startedAt, { coldQueryBudget: 4 });
  return result;
}

export type AdminActivityItem = {
  id: string;
  kind: "order" | "payment" | "notification" | "refund" | "identity";
  tone: "neutral" | "success" | "warning" | "danger";
  title: string;
  detail: string;
  orderId: string | null;
  orderCode: string | null;
  createdAt: string;
};

function eventPresentation(type: string): Pick<AdminActivityItem, "kind" | "tone" | "title"> {
  const normalized = type.toUpperCase();
  if (normalized.startsWith("POST_PURCHASE_")) {
    const channel = normalized.includes("_TG_") ? "Telegram" : "ВКонтакте";
    return { kind: "notification", tone: "success", title: `Клиент открыл ${channel}` };
  }
  if (normalized === "OUTBOX_REPLAY_REQUESTED") return { kind: "notification", tone: "warning", title: "Повтор доставки запрошен" };
  if (normalized.includes("REFUND")) return { kind: "refund", tone: "warning", title: "Событие возврата" };
  if (normalized.includes("CONFIRMED")) return { kind: "payment", tone: "success", title: "Оплата подтверждена" };
  if (normalized.includes("FAILED") || normalized.includes("REJECTED") || normalized.includes("ERROR")) return { kind: "payment", tone: "danger", title: "Операция требует внимания" };
  if (normalized.includes("PAYMENT")) return { kind: "payment", tone: "neutral", title: "Событие платежа" };
  return { kind: "order", tone: "neutral", title: "Событие заказа" };
}

function decodeActivityCursor(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof value.createdAt !== "string" || typeof value.id !== "string") return null;
    const createdAt = new Date(value.createdAt);
    return Number.isFinite(createdAt.getTime()) ? { createdAt, id: value.id } : null;
  } catch {
    return null;
  }
}

export async function getAdminActivity(limit = 180, cursorRaw?: string | null): Promise<AdminActivityItem[]> {
  const cursor = decodeActivityCursor(cursorRaw);
  const [events, outbox, refunds, merges] = await Promise.all([
    prisma.orderEvent.findMany({
      where: cursor ? { createdAt: { lte: cursor.createdAt } } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        type: true,
        createdAt: true,
        order: { select: { id: true, wbCode: true, publicOrderId: true } },
      },
    }),
    prisma.outboxMessage.findMany({
      where: cursor ? { updatedAt: { lte: cursor.createdAt } } : undefined,
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        topic: true,
        status: true,
        attempts: true,
        createdAt: true,
        updatedAt: true,
        event: { select: { order: { select: { id: true, wbCode: true, publicOrderId: true } } } },
      },
    }),
    prisma.paymentRefund.findMany({
      where: cursor ? { updatedAt: { lte: cursor.createdAt } } : undefined,
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        status: true,
        amountKopecks: true,
        createdAt: true,
        updatedAt: true,
        paymentAttempt: { select: { order: { select: { id: true, wbCode: true, publicOrderId: true } } } },
      },
    }),
    prisma.accountMergeAudit.findMany({
      where: cursor ? { updatedAt: { lte: cursor.createdAt } } : undefined,
      orderBy: { updatedAt: "desc" },
      take: Math.min(limit, 80),
      select: { id: true, status: true, createdAt: true, updatedAt: true },
    }),
  ]);

  const items: AdminActivityItem[] = [];
  for (const event of events) {
    const presentation = eventPresentation(event.type);
    items.push({
      id: `event:${event.id}`,
      ...presentation,
      detail: event.type,
      orderId: event.order.id,
      orderCode: event.order.publicOrderId ?? event.order.wbCode,
      createdAt: event.createdAt.toISOString(),
    });
  }
  for (const message of outbox) {
    const order = message.event.order;
    const tone = message.status === "DEAD" ? "danger" : message.status === "DELIVERED" ? "success" : "warning";
    items.push({
      id: `outbox:${message.id}`,
      kind: "notification",
      tone,
      title: message.status === "DELIVERED" ? "Уведомление доставлено" : message.status === "DEAD" ? "Уведомление требует внимания" : "Уведомление в очереди",
      detail: `${message.topic} · попыток ${message.attempts}`,
      orderId: order.id,
      orderCode: order.publicOrderId ?? order.wbCode,
      createdAt: message.updatedAt.toISOString(),
    });
  }
  for (const refund of refunds) {
    const order = refund.paymentAttempt.order;
    const tone = refund.status === "CONFIRMED" ? "success" : refund.status === "SUBMIT_UNKNOWN" ? "danger" : "warning";
    items.push({
      id: `refund:${refund.id}`,
      kind: "refund",
      tone,
      title: refund.status === "CONFIRMED" ? "Возврат подтверждён" : refund.status === "SUBMIT_UNKNOWN" ? "Исход возврата неизвестен" : "Возврат обновлён",
      detail: `${(refund.amountKopecks / 100).toFixed(2)} ₽ · ${refund.status}`,
      orderId: order.id,
      orderCode: order.publicOrderId ?? order.wbCode,
      createdAt: refund.updatedAt.toISOString(),
    });
  }
  for (const merge of merges) {
    items.push({
      id: `merge:${merge.id}`,
      kind: "identity",
      tone: merge.status === "COMPLETED" ? "success" : merge.status === "FAILED" ? "danger" : "warning",
      title: "Объединение профилей",
      detail: merge.status,
      orderId: null,
      orderCode: null,
      createdAt: merge.updatedAt.toISOString(),
    });
  }

  return items
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))
    .filter((item) => !cursor
      || Date.parse(item.createdAt) < cursor.createdAt.getTime()
      || (Date.parse(item.createdAt) === cursor.createdAt.getTime() && item.id < cursor.id))
    .slice(0, limit);
}

export async function getAdminActivityPage(input: { cursor?: string | null; limit?: number } = {}) {
  const limit = Math.min(100, Math.max(20, input.limit ?? 80));
  const fetched = await getAdminActivity(limit + 1, input.cursor);
  const hasMore = fetched.length > limit;
  const items = fetched.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last
      ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString("base64url")
      : null,
  };
}

export function getAdminRuntimeState() {
  const acquiringEnabled = isSiteAcquiringEnabled();
  const acquiringMode = parseSiteAcquiringMode();
  return {
    acquiring: acquiringEnabled ? acquiringMode : "off",
    terminalConfigured: Boolean(process.env.TINKOFF_TERMINAL_KEY && process.env.TINKOFF_SECRET_KEY),
    fiscalConfigured: Boolean(
      process.env.TINKOFF_TAXATION &&
      process.env.TINKOFF_ITEM_TAX &&
      process.env.TINKOFF_PAYMENT_METHOD &&
      process.env.TINKOFF_PAYMENT_OBJECT
    ),
    emailConfigured: Boolean(process.env.SMTP_USER && process.env.SMTP_PASSWORD),
  };
}

export async function getAdminOrderDetail(id: string) {
  return prisma.wbOrder.findUnique({
    where: { id },
    select: {
      id: true,
      isTest: true,
      wbCode: true,
      publicOrderId: true,
      orderSource: true,
      platform: true,
      status: true,
      amount: true,
      robloxUsername: true,
      probableNick: true,
      gamepassUrl: true,
      pendingAt: true,
      completedAt: true,
      createdAt: true,
      receiptEmail: true,
      gamepassId: true,
      paymentAmountKopecks: true,
      saleAmountKopecks: true,
      bonusAppliedRobux: true,
      discountAppliedKopecks: true,
      termsVersion: true,
      purchaseCostKopecks: true,
      profitKopecks: true,
      purchaserUsername: true,
      adminNote: true,
      user: {
        select: {
          name: true,
          username: true,
          email: true,
          tgId: true,
          vkId: true,
          balance: true,
          identities: {
            select: { provider: true, verifiedAt: true },
          },
        },
      },
      priceQuote: {
        select: {
          policyVersion: true,
          requestedRobux: true,
          bonusRobux: true,
          baseAmountKopecks: true,
          discountKopecks: true,
          finalAmountKopecks: true,
          status: true,
          createdAt: true,
        },
      },
      paymentAttempts: {
        orderBy: { createdAt: "desc" },
        select: {
          status: true,
          provider: true,
          paymentId: true,
          amountKopecks: true,
          refundedAmountKopecks: true,
          initiatedAt: true,
          finalizedAt: true,
          refunds: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              status: true,
              amountKopecks: true,
              reason: true,
              createdAt: true,
            },
          },
        },
      },
      events: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          type: true,
          createdAt: true,
          outbox: { select: { id: true, topic: true, status: true, attempts: true } },
        },
      },
    },
  });
}
