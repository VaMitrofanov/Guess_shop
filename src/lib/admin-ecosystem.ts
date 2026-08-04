import "server-only";

import { PaymentAttemptStatus, WbOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSiteAcquiringEnabled, parseSiteAcquiringMode } from "@/lib/site-acquiring";
import { buildTabWhere } from "@/lib/order-queue";

const PAID_PAYMENT_STATUSES: PaymentAttemptStatus[] = [
  "CONFIRMED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
];

const OPEN_PAYMENT_STATUSES: PaymentAttemptStatus[] = ["CREATED", "INITIATED", "AUTHORIZED"];
const ACTIVE_ORDER_STATUSES: WbOrderStatus[] = [
  "AWAITING_PAYMENT",
  "PAYMENT_PENDING",
  "AWAITING_GAMEPASS",
  "PENDING",
  "IN_PROGRESS",
];

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
    orderBy: { createdAt: "desc" },
    take: limit,
    include: orderListInclude,
  });
  return orders.map(serializeOrder);
}

export async function getAdminDashboardData() {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalOrders,
    siteOrders,
    activeOrders,
    buyoutOrders,
    created24h,
    completed24h,
    completedOrders,
    orders30d,
    errorOrders,
    users,
    users30d,
    paymentTotals,
    paymentTotals30d,
    openPayments,
    deadOutbox,
    pendingOutbox,
    unknownRefunds,
    recentRows,
    completedRobux,
    sourceRows,
    customerOrderCounts,
    codeRows,
    heartbeatRows,
  ] = await Promise.all([
    prisma.wbOrder.count({ where: { isTest: false } }),
    prisma.wbOrder.count({ where: { isTest: false, orderSource: "SITE" } }),
    prisma.wbOrder.count({ where: { isTest: false, status: { in: ACTIVE_ORDER_STATUSES } } }),
    prisma.wbOrder.count({ where: { isTest: false, ...buildTabWhere("BUYOUT") } }),
    prisma.wbOrder.count({ where: { isTest: false, createdAt: { gte: since24h } } }),
    prisma.wbOrder.count({ where: { isTest: false, completedAt: { gte: since24h } } }),
    prisma.wbOrder.count({ where: { isTest: false, status: "COMPLETED" } }),
    prisma.wbOrder.count({ where: { isTest: false, createdAt: { gte: since30d } } }),
    prisma.wbOrder.count({ where: { isTest: false, status: "ERROR" } }),
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: since30d } } }),
    prisma.paymentAttempt.aggregate({
      where: { status: { in: PAID_PAYMENT_STATUSES }, order: { isTest: false } },
      _sum: { amountKopecks: true, refundedAmountKopecks: true },
      _count: { _all: true },
    }),
    prisma.paymentAttempt.aggregate({
      where: {
        status: { in: PAID_PAYMENT_STATUSES },
        finalizedAt: { gte: since30d },
        order: { isTest: false },
      },
      _sum: { amountKopecks: true, refundedAmountKopecks: true },
      _count: { _all: true },
    }),
    prisma.paymentAttempt.count({ where: { status: { in: OPEN_PAYMENT_STATUSES }, order: { isTest: false } } }),
    prisma.outboxMessage.count({ where: { status: "DEAD" } }),
    prisma.outboxMessage.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
    prisma.paymentRefund.count({
      where: { status: "SUBMIT_UNKNOWN", paymentAttempt: { order: { isTest: false } } },
    }),
    prisma.wbOrder.findMany({
      where: { isTest: false },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: orderListInclude,
    }),
    prisma.wbOrder.aggregate({
      where: { isTest: false, status: "COMPLETED" },
      _sum: { amount: true },
    }),
    prisma.wbOrder.groupBy({
      by: ["orderSource"],
      where: { isTest: false },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.wbOrder.groupBy({
      by: ["userId"],
      where: { isTest: false },
      _count: { _all: true },
    }),
    prisma.wbCode.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.serviceHeartbeat.findMany({
      orderBy: { lastSeenAt: "desc" },
      take: 6,
      select: { serviceKey: true, status: true, lastSeenAt: true, lastAlertAt: true },
    }),
  ]);

  const grossKopecks = paymentTotals._sum.amountKopecks ?? 0;
  const refundedKopecks = paymentTotals._sum.refundedAmountKopecks ?? 0;
  const grossKopecks30d = paymentTotals30d._sum.amountKopecks ?? 0;
  const refundedKopecks30d = paymentTotals30d._sum.refundedAmountKopecks ?? 0;
  const codeCounts = Object.fromEntries(codeRows.map((row) => [row.status, row._count._all]));

  return {
    metrics: {
      totalOrders,
      siteOrders,
      activeOrders,
      buyoutOrders,
      created24h,
      completed24h,
      completedOrders,
      orders30d,
      users,
      users30d,
      uniqueBuyers: customerOrderCounts.length,
      repeatBuyers: customerOrderCounts.filter((row) => row._count._all > 1).length,
      paidPayments: paymentTotals._count._all,
      averagePaidKopecks: paymentTotals._count._all > 0 ? Math.round(grossKopecks / paymentTotals._count._all) : 0,
      grossKopecks,
      refundedKopecks,
      netKopecks: grossKopecks - refundedKopecks,
      paidPayments30d: paymentTotals30d._count._all,
      grossKopecks30d,
      refundedKopecks30d,
      netKopecks30d: grossKopecks30d - refundedKopecks30d,
      completedRobux: completedRobux._sum.amount ?? 0,
      attention: errorOrders + deadOutbox + unknownRefunds,
      errorOrders,
      openPayments,
      deadOutbox,
      pendingOutbox,
      unknownRefunds,
      availableCodes: codeCounts.AVAILABLE ?? 0,
      reservedCodes: codeCounts.RESERVED ?? 0,
      claimedCodes: codeCounts.CLAIMED ?? 0,
    },
    sourceBreakdown: sourceRows
      .map((row) => ({ source: row.orderSource, orders: row._count._all, robux: row._sum.amount ?? 0 }))
      .sort((a, b) => b.orders - a.orders),
    heartbeats: heartbeatRows.map((row) => ({
      service: row.serviceKey,
      status: row.status,
      lastSeenAt: row.lastSeenAt.toISOString(),
      lastAlertAt: iso(row.lastAlertAt),
      ageSeconds: Math.max(0, Math.floor((now.getTime() - row.lastSeenAt.getTime()) / 1000)),
    })),
    recentOrders: recentRows.map(serializeOrder),
  };
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

export async function getAdminActivity(limit = 180): Promise<AdminActivityItem[]> {
  const [events, outbox, refunds, merges] = await Promise.all([
    prisma.orderEvent.findMany({
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
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
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
    include: {
      user: {
        include: {
          identities: {
            select: { provider: true, subject: true, verifiedAt: true, createdAt: true },
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
        include: { refunds: { orderBy: { createdAt: "desc" } } },
      },
      events: {
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { outbox: true },
      },
    },
  });
}
