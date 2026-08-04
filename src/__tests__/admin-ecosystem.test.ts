jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/prisma", () => ({
  prisma: {
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
import { getAdminActivity, getAdminDashboardData, getAdminOrders, getAdminRuntimeState } from "@/lib/admin-ecosystem";

const db = prisma as unknown as {
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
    // total, site, active, buyout, created24h, completed24h, completed, 30d, errors
    [641, 4, 75, 10, 10, 8, 533, 403, 0].forEach((value) => db.wbOrder.count.mockResolvedValueOnce(value));
    db.user.count.mockResolvedValueOnce(597).mockResolvedValueOnce(356);
    db.paymentAttempt.aggregate
      .mockResolvedValueOnce({ _sum: { amountKopecks: 16000, refundedAmountKopecks: 16000 }, _count: { _all: 1 } })
      .mockResolvedValueOnce({ _sum: { amountKopecks: 16000, refundedAmountKopecks: 16000 }, _count: { _all: 1 } });
    db.paymentAttempt.count.mockResolvedValue(0);
    db.outboxMessage.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    db.paymentRefund.count.mockResolvedValue(0);
    db.wbOrder.findMany.mockResolvedValue([]);
    db.wbOrder.aggregate.mockResolvedValue({ _sum: { amount: 488821 } });
    db.wbOrder.groupBy
      .mockResolvedValueOnce([
        { orderSource: "WB", _count: { _all: 587 }, _sum: { amount: 450000 } },
        { orderSource: "SITE", _count: { _all: 4 }, _sum: { amount: 3200 } },
      ])
      .mockResolvedValueOnce([
        { userId: "user-1", _count: { _all: 3 } },
        { userId: "user-2", _count: { _all: 1 } },
      ]);
    db.wbCode.groupBy.mockResolvedValue([
      { status: "AVAILABLE", _count: { _all: 740 } },
      { status: "RESERVED", _count: { _all: 30 } },
    ]);
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
  });
});
