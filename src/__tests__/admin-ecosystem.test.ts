jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/admin-cache", () => ({ adminCache: (fn: unknown) => fn }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    wbOrder: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn(), aggregate: jest.fn(), groupBy: jest.fn() },
    user: { count: jest.fn() },
    paymentAttempt: { aggregate: jest.fn(), count: jest.fn() },
    outboxMessage: { count: jest.fn(), findMany: jest.fn() },
    paymentRefund: { count: jest.fn(), findMany: jest.fn() },
    orderEvent: { findMany: jest.fn() },
    accountMergeAudit: { findMany: jest.fn() },
    wbCode: { groupBy: jest.fn() },
    serviceHeartbeat: { findMany: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { getAdminActivity, getAdminDashboardData, getAdminOrders, getAdminOrdersPage, getAdminRuntimeState } from "@/lib/admin-ecosystem";

const db = prisma as unknown as {
  $queryRaw: jest.Mock;
  wbOrder: { findMany: jest.Mock; count: jest.Mock; aggregate: jest.Mock; groupBy: jest.Mock };
  user: { count: jest.Mock };
  paymentAttempt: { aggregate: jest.Mock; count: jest.Mock };
  outboxMessage: { findMany: jest.Mock; count: jest.Mock };
  paymentRefund: { findMany: jest.Mock; count: jest.Mock };
  orderEvent: { findMany: jest.Mock };
  accountMergeAudit: { findMany: jest.Mock };
  wbCode: { groupBy: jest.Mock };
  serviceHeartbeat: { findMany: jest.Mock };
};

describe("admin ecosystem", () => {
  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.SITE_ACQUIRING_ENABLED;
    delete process.env.SITE_ACQUIRING_MODE;
    delete process.env.TINKOFF_TERMINAL_KEY;
    delete process.env.TINKOFF_SECRET_KEY;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
  });

  it("serializes canonical WbOrder rows instead of legacy Order", async () => {
    db.wbOrder.findMany.mockResolvedValue([{
      id: "order-1",
      wbCode: "SITE001",
      publicOrderId: "RB-1001",
      orderSource: "SITE",
      platform: "WEB",
      status: "PENDING",
      amount: 1000,
      robloxUsername: "Builder",
      probableNick: null,
      createdAt: new Date("2026-07-18T10:00:00Z"),
      updatedAt: new Date("2026-07-18T10:01:00Z"),
      paidAt: new Date("2026-07-18T10:01:00Z"),
      completedAt: null,
      user: { name: "Client", username: "client", email: "client@example.test" },
      paymentAttempts: [{
        id: "payment-1",
        status: "CONFIRMED",
        amountKopecks: 80000,
        refundedAmountKopecks: 0,
        updatedAt: new Date("2026-07-18T10:01:00Z"),
      }],
    }]);

    await expect(getAdminOrders()).resolves.toEqual([expect.objectContaining({
      id: "order-1",
      code: "RB-1001",
      source: "SITE",
      amountRobux: 1000,
      attention: false,
      payment: expect.objectContaining({ status: "CONFIRMED", amountKopecks: 80000 }),
    })]);
  });

  it("uses a bounded stable cursor and searches the full order data source", async () => {
    const source = Array.from({ length: 51 }, (_, index) => ({
      id: `order-${String(index).padStart(4, "0")}`,
      wbCode: `CODE${index}`,
      publicOrderId: `RB-${index}`,
      orderSource: "SITE",
      platform: "WEB",
      status: "PENDING",
      amount: 100,
      robloxUsername: `Builder${index}`,
      probableNick: null,
      createdAt: new Date(1_800_000_000_000 - index * 1000),
      updatedAt: new Date(1_800_000_000_000 - index * 1000),
      paidAt: null,
      completedAt: null,
      user: { name: "Client", username: "client", email: "client@example.test" },
      paymentAttempts: [],
    }));
    db.wbOrder.findMany.mockResolvedValue(source);

    const first = await getAdminOrdersPage({ query: "Builder", filter: "SITE", limit: 50 });
    expect(first.orders).toHaveLength(50);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(db.wbOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 51,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      where: { AND: expect.arrayContaining([
        { isTest: false },
        { orderSource: "SITE" },
        expect.objectContaining({ OR: expect.any(Array) }),
      ]) },
    }));

    db.wbOrder.findMany.mockResolvedValue([]);
    await getAdminOrdersPage({ cursor: first.nextCursor, limit: 50 });
    const secondWhere = db.wbOrder.findMany.mock.calls.at(-1)?.[0].where;
    expect(secondWhere.AND).toEqual(expect.arrayContaining([
      expect.objectContaining({ OR: expect.any(Array) }),
    ]));
  });

  it("merges payment, outbox, refund and identity logs by time", async () => {
    db.orderEvent.findMany.mockResolvedValue([{
      id: "event-1", type: "PAYMENT_CONFIRMED", createdAt: new Date("2026-07-18T10:00:00Z"),
      order: { id: "order-1", wbCode: "SITE001", publicOrderId: "RB-1001" },
    }]);
    db.outboxMessage.findMany.mockResolvedValue([{
      id: "outbox-1", topic: "payment.confirmed", status: "DELIVERED", attempts: 1,
      createdAt: new Date("2026-07-18T10:00:00Z"), updatedAt: new Date("2026-07-18T10:02:00Z"),
      event: { order: { id: "order-1", wbCode: "SITE001", publicOrderId: "RB-1001" } },
    }]);
    db.paymentRefund.findMany.mockResolvedValue([]);
    db.accountMergeAudit.findMany.mockResolvedValue([]);

    const activity = await getAdminActivity();
    expect(activity.map((item) => item.id)).toEqual(["outbox:outbox-1", "event:event-1"]);
    expect(activity[0]).toEqual(expect.objectContaining({ title: "Уведомление доставлено", orderCode: "RB-1001" }));
  });

  it("reports only configuration presence and keeps acquiring fail-closed", () => {
    process.env.SITE_ACQUIRING_ENABLED = "false";
    process.env.SITE_ACQUIRING_MODE = "on";
    process.env.TINKOFF_TERMINAL_KEY = "configured";
    process.env.TINKOFF_SECRET_KEY = "configured";

    expect(getAdminRuntimeState()).toEqual(expect.objectContaining({
      acquiring: "off",
      terminalConfigured: true,
      emailConfigured: false,
    }));

    process.env.SITE_ACQUIRING_ENABLED = "true";
    process.env.SITE_ACQUIRING_MODE = "unexpected";
    expect(getAdminRuntimeState().acquiring).toBe("off");
  });

  it("derives dashboard money, source, repeat-buyer and health metrics from production-shaped aggregates", async () => {
    const n = (value: number) => BigInt(value);
    db.$queryRaw
      .mockResolvedValueOnce([{
        totalOrders: n(641),
        activeOrders: n(75),
        buyoutOrders: n(10),
        created24h: n(10),
        completed24h: n(8),
        errorOrders: n(0),
        users: n(597),
        users30d: n(356),
        openPayments: n(0),
        deadOutbox: n(0),
        pendingOutbox: n(0),
        unknownRefunds: n(0),
        uniqueBuyers: n(2),
        repeatBuyers: n(1),
        availableCodes: n(740),
        reservedCodes: n(30),
      }])
      .mockResolvedValueOnce([
        {
          completedOrders: n(533),
          orders30d: n(403),
          completedRobux: n(488821),
          paidPayments: n(1),
          grossKopecks: n(16000),
          refundedKopecks: n(16000),
          paidPayments30d: n(1),
          grossKopecks30d: n(16000),
          refundedKopecks30d: n(16000),
          source: "WB",
          sourceOrders: n(587),
          sourceRobux: n(450000),
        },
        {
          completedOrders: n(533),
          orders30d: n(403),
          completedRobux: n(488821),
          paidPayments: n(1),
          grossKopecks: n(16000),
          refundedKopecks: n(16000),
          paidPayments30d: n(1),
          grossKopecks30d: n(16000),
          refundedKopecks30d: n(16000),
          source: "SITE",
          sourceOrders: n(4),
          sourceRobux: n(3200),
        },
      ]);
    db.wbOrder.findMany.mockResolvedValue([]);
    db.serviceHeartbeat.findMany.mockResolvedValue([{
      serviceKey: "tg-payment-outbox",
      status: "HEALTHY",
      lastSeenAt: new Date(),
      lastAlertAt: null,
    }]);

    const dashboard = await getAdminDashboardData();
    expect(dashboard.metrics).toEqual(expect.objectContaining({
      totalOrders: 641,
      buyoutOrders: 10,
      completedOrders: 533,
      netKopecks: 0,
      averagePaidKopecks: 16000,
      completedRobux: 488821,
      uniqueBuyers: 2,
      repeatBuyers: 1,
      availableCodes: 740,
    }));
    expect(dashboard.sourceBreakdown[0]).toEqual({ source: "WB", orders: 587, robux: 450000 });
    expect(dashboard.heartbeats[0]).toEqual(expect.objectContaining({ service: "tg-payment-outbox", status: "HEALTHY" }));
    expect(dashboard.heartbeats[0].lastSeenAt).toEqual(expect.any(String));
    expect(() => JSON.stringify(dashboard)).not.toThrow();
  });
});
