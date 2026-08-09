const findExisting = jest.fn();
const transaction = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    wbOrder: { findUnique: findExisting },
    $transaction: transaction,
  },
}));

import { createCanonicalBotOrder } from "@/lib/canonical-bot-order";

describe("canonical bot order", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BOT_PAYMENT_API_SECRET = "test-secret-that-is-longer-than-thirty-two-characters";
    findExisting.mockResolvedValue(null);
  });

  test("atomically consumes an owned intent and creates a manual payment attempt", async () => {
    const now = new Date("2026-08-09T12:00:00.000Z");
    const tx = {
      directIntent: {
        findUnique: jest.fn().mockResolvedValue({
          id: "cm1234567890example",
          userId: "user-1",
          amount: 500,
          bonus: 0,
          totalAmount: 500,
          rubleDiscount: 0,
          rublePrice: 450,
          robloxUsername: "Builderman",
          gamepassId: "12345",
          gamepassUrl: "https://www.roblox.com/game-pass/12345",
          platform: "TG",
          status: "PENDING",
          createdAt: new Date(now.getTime() - 60_000),
          user: { id: "user-1", tgId: "777", vkId: null, rubleDiscount: 0 },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      wbOrder: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "order-1", ...data })) },
      paymentAttempt: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "attempt-1", ...data })) },
      consentEvidence: { create: jest.fn().mockResolvedValue({ id: "consent-1" }) },
      orderEvent: { create: jest.fn().mockResolvedValue({ id: "event-1" }) },
      outboxMessage: { create: jest.fn().mockResolvedValue({ id: "outbox-1" }) },
    };
    transaction.mockImplementation(async (callback) => callback(tx));

    const result = await createCanonicalBotOrder({
      intentId: "cm1234567890example",
      platform: "TG",
      subject: "777",
      receiptEmail: "Buyer@Example.com",
      method: "MANUAL_TRANSFER",
      manualConfigVersion: "2026-08-09",
      now,
    });

    expect(tx.directIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "cm1234567890example", status: "PENDING" },
    }));
    expect(tx.wbOrder.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      status: "PAYMENT_PENDING",
      receiptEmail: "buyer@example.com",
      paymentDetails: "MANUAL_TRANSFER:2026-08-09",
      webIdempotencyKey: "direct-intent:cm1234567890example",
    }) });
    expect(tx.paymentAttempt.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      provider: "MANUAL_TRANSFER",
      status: "INITIATED",
      amountKopecks: 45_000,
    }) });
    expect(tx.consentEvidence.create).toHaveBeenCalled();
    expect(tx.outboxMessage.create).toHaveBeenCalled();
    expect(result.statusToken).toHaveLength(43);
  });

  test("does not reveal an intent to another Telegram user", async () => {
    const tx = {
      directIntent: { findUnique: jest.fn().mockResolvedValue({
        id: "cm1234567890example", platform: "TG", status: "PENDING", createdAt: new Date(),
        user: { tgId: "777", vkId: null },
      }) },
    };
    transaction.mockImplementation(async (callback) => callback(tx));
    await expect(createCanonicalBotOrder({
      intentId: "cm1234567890example",
      platform: "TG",
      subject: "999",
      receiptEmail: "buyer@example.com",
      method: "SITE",
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
