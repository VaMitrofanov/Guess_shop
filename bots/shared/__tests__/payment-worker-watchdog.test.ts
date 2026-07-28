const sent: string[] = [];
let telegramSucceeds = true;
const heartbeat = {
  serviceKey: "tg-payment-outbox",
  lastSeenAt: new Date("2026-07-28T11:50:00Z"),
  status: "HEALTHY",
  lastAlertAt: null as Date | null,
};
const backlog = {
  serviceKey: "payment-outbox-backlog",
  lastSeenAt: new Date("2026-07-28T12:00:00Z"),
  status: "HEALTHY",
  lastAlertAt: null as Date | null,
};

jest.mock("../notify", () => ({
  tgSend: jest.fn(async (_id: string, text: string) => {
    sent.push(text);
    return telegramSucceeds ? { ok: true } : {};
  }),
}));

jest.mock("../db", () => ({
  db: {
    serviceHeartbeat: {
      findUnique: async () => heartbeat,
      updateMany: async (input: { where: { serviceKey: string }; data: { status?: string; lastAlertAt?: Date | null } }) => {
        const row = input.where.serviceKey === heartbeat.serviceKey ? heartbeat : backlog;
        if (input.data.status !== undefined) row.status = input.data.status;
        if (input.data.lastAlertAt !== undefined) row.lastAlertAt = input.data.lastAlertAt;
        return { count: 1 };
      },
      upsert: async (input: { update: { lastSeenAt: Date } }) => {
        backlog.lastSeenAt = input.update.lastSeenAt;
        return backlog;
      },
    },
    outboxMessage: { count: async () => 0 },
  },
}));

import { inspectPaymentWorkerFromIndependentProcess } from "../payment-worker-watchdog";

describe("independent VK-side payment worker watchdog", () => {
  beforeEach(() => {
    sent.length = 0;
    heartbeat.lastSeenAt = new Date("2026-07-28T11:50:00Z");
    heartbeat.status = "HEALTHY";
    heartbeat.lastAlertAt = null;
    backlog.status = "HEALTHY";
    telegramSucceeds = true;
    process.env.TG_TOKEN = "test-token";
    process.env.ADMIN_IDS = "111,222";
    process.env.VALIDATOR_KEY = "validator-key";
    process.env.NEXT_PUBLIC_APP_URL = "https://shop.example";
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ delivered: true }),
    })) as jest.Mock;
  });

  test("alerts while TG is stale and sends recovery after heartbeat resumes", async () => {
    const staleNow = new Date("2026-07-28T12:00:00Z");
    await inspectPaymentWorkerFromIndependentProcess(staleNow);
    expect(heartbeat.status).toBe("STALE");
    expect(heartbeat.lastAlertAt).toEqual(staleNow);
    expect(sent.filter((text) => text.includes("ОСТАНОВЛЕН"))).toHaveLength(2);

    sent.length = 0;
    const recoveredNow = new Date("2026-07-28T12:01:00Z");
    heartbeat.lastSeenAt = recoveredNow;
    await inspectPaymentWorkerFromIndependentProcess(recoveredNow);
    expect(heartbeat.status).toBe("HEALTHY");
    expect(sent.filter((text) => text.includes("ВОССТАНОВЛЕН"))).toHaveLength(2);
  });

  test("uses the independent Web email channel when Telegram transport fails", async () => {
    telegramSucceeds = false;
    const staleNow = new Date("2026-07-28T12:00:00Z");
    await inspectPaymentWorkerFromIndependentProcess(staleNow);

    expect(heartbeat.status).toBe("STALE");
    expect(heartbeat.lastAlertAt).toEqual(staleNow);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://shop.example/api/internal/worker-alert",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
