const findExisting = jest.fn();
const transaction = jest.fn();
/* Гейт приёма заказа (08.09.2026) перепроверяет пасс ДО транзакции: цену,
   владельца, «в продаже» и повтор уже выкупленного. Мок обязан это уметь,
   иначе тест проверяет создание заказа в обход собственной защиты. */
const intentFindUnique = jest.fn();
const orderFindFirst = jest.fn();
const gamepassById = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    wbOrder: { findUnique: findExisting, findFirst: orderFindFirst },
    directIntent: { findUnique: intentFindUnique },
    $transaction: transaction,
  },
}));
jest.mock("@/lib/roblox", () => ({
  getGamepassById: (...args: unknown[]) => gamepassById(...args),
}));

import { createCanonicalBotOrder } from "@/lib/canonical-bot-order";

describe("canonical bot order", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BOT_PAYMENT_API_SECRET = "test-secret-that-is-longer-than-thirty-two-characters";
    findExisting.mockResolvedValue(null);
    orderFindFirst.mockResolvedValue(null);
    intentFindUnique.mockResolvedValue({
      id: "cm1234567890example",
      totalAmount: 500,
      robloxUsername: "Builderman",
      gamepassId: "12345",
      gamepassUrl: "https://www.roblox.com/game-pass/12345",
      platform: "TG",
      user: { tgId: "777", vkId: null },
    });
    // 500 R$ → пасс ровно на 715 R$ (ceil(500 / 0.7)).
    gamepassById.mockResolvedValue({ price: 715, isForSale: true, creatorName: "Builderman" });
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
  describe("гейт приёма: пасс заявки перепроверяется перед созданием заказа", () => {
    const call = () => createCanonicalBotOrder({
      intentId: "cm1234567890example",
      platform: "TG",
      subject: "777",
      receiptEmail: "buyer@example.com",
      method: "MANUAL_TRANSFER",
      manualConfigVersion: "2026-08-09-v1",
    });

    test("цену подняли после заявки — заказ не создаётся", async () => {
      gamepassById.mockResolvedValue({ price: 1429, isForSale: true, creatorName: "Builderman" });
      await expect(call()).rejects.toMatchObject({ code: "GAMEPASS_CHANGED" });
      expect(transaction).not.toHaveBeenCalled();
    });

    test("пасс сняли с продажи — заказ не создаётся", async () => {
      gamepassById.mockResolvedValue({ price: 715, isForSale: false, creatorName: "Builderman" });
      await expect(call()).rejects.toMatchObject({ code: "GAMEPASS_CHANGED" });
    });

    test("пасс чужого аккаунта — заказ не создаётся", async () => {
      gamepassById.mockResolvedValue({ price: 715, isForSale: true, creatorName: "SomeoneElse" });
      await expect(call()).rejects.toMatchObject({ code: "GAMEPASS_CHANGED" });
    });

    test("пасс уже выкуплен по другому заказу — заказ не создаётся", async () => {
      orderFindFirst.mockResolvedValue({ wbCode: "M8L74FX" });
      await expect(call()).rejects.toMatchObject({ code: "GAMEPASS_CHANGED" });
    });

    test("Roblox молчит — оплату не блокируем: это наша недоступность, не вина клиента", async () => {
      gamepassById.mockResolvedValue(null);
      transaction.mockImplementation(async () => { throw new Error("дошли до транзакции"); });
      await expect(call()).rejects.toThrow("дошли до транзакции");
    });
  });
});
