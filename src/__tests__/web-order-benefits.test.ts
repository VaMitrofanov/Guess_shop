import { reserveLatePaymentBenefitsTx, type LatePaymentBenefitOrder } from "@/lib/web-order-benefits";

function order(overrides: Partial<LatePaymentBenefitOrder> = {}): LatePaymentBenefitOrder {
  return {
    id: "order-1",
    userId: "user-1",
    priceQuoteId: "quote-1",
    publicOrderId: "RB-1",
    bonusAppliedRobux: 100,
    discountAppliedKopecks: 2_500,
    benefitsRevertedAt: new Date("2026-08-09T10:00:00Z"),
    benefitsRevision: 0,
    orderSource: "SITE",
    ...overrides,
  };
}

describe("late payment benefit reservation", () => {
  it("atomically re-reserves returned bonus and discount", async () => {
    const ledger: Array<Record<string, unknown>> = [];
    const tx = {
      user: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ balance: 250 }),
      },
      bonusLedger: { create: jest.fn(async ({ data }) => { ledger.push(data); return data; }) },
    };

    const result = await reserveLatePaymentBenefitsTx(tx as never, order(), "attempt-1");

    expect(result).toEqual({ reserved: true, revision: 1 });
    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", balance: { gte: 100 }, rubleDiscount: { gte: 25 } },
      data: { balance: { decrement: 100 }, rubleDiscount: { decrement: 25 } },
    });
    expect(ledger[0]).toMatchObject({
      deltaRobux: -100,
      balanceAfter: 250,
      idempotencyKey: "web-order-bonus-late-payment:attempt-1",
    });
  });

  it("fails closed when the returned benefits were already spent", async () => {
    const tx = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      bonusLedger: { create: jest.fn() },
    };

    await expect(reserveLatePaymentBenefitsTx(tx as never, order(), "attempt-2"))
      .resolves.toEqual({ reserved: false, reason: "benefits_changed" });
    expect(tx.bonusLedger.create).not.toHaveBeenCalled();
  });

  it("does not touch the user when benefits were never returned", async () => {
    const tx = { user: { updateMany: jest.fn() }, bonusLedger: { create: jest.fn() } };
    await expect(reserveLatePaymentBenefitsTx(
      tx as never,
      order({ benefitsRevertedAt: null }),
      "attempt-3",
    )).resolves.toEqual({ reserved: true, revision: 0 });
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });
});
