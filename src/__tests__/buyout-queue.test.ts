import {
  PAID_BUYOUT_SCOPE,
  PAID_BUYOUT_SQL,
  belongsToBuyoutQueue,
  isUnpaidDirect,
} from "../lib/buyout-queue";

const order = (over: Partial<Parameters<typeof belongsToBuyoutQueue>[0]> = {}) => ({
  isDirectOrder: false,
  paidAt: null,
  status: "PENDING",
  orderSource: "WB",
  ...over,
});

describe("Общая очередь выкупа", () => {
  test("WB-заказ в PENDING — в очереди", () => {
    expect(belongsToBuyoutQueue(order())).toBe(true);
  });

  test("оплаченный прямой заказ попадает в общую очередь", () => {
    expect(belongsToBuyoutQueue(order({
      isDirectOrder: true, orderSource: "DIRECT", paidAt: "2026-07-25T10:00:00.000Z",
    }))).toBe(true);
  });

  test("прямой заказ без подтверждённой оплаты — вне очереди", () => {
    const unpaid = order({ isDirectOrder: true, orderSource: "DIRECT", paidAt: null });
    expect(isUnpaidDirect(unpaid)).toBe(true);
    expect(belongsToBuyoutQueue(unpaid)).toBe(false);
  });

  test("Авито остаётся отдельной очередью", () => {
    expect(belongsToBuyoutQueue(order({ orderSource: "AVITO" }))).toBe(false);
  });

  test("статусы вне выкупа не считаются очередью", () => {
    for (const status of ["AWAITING_GAMEPASS", "AWAITING_PAYMENT", "PAYMENT_PENDING", "COMPLETED", "REJECTED", "ERROR"]) {
      expect(belongsToBuyoutQueue(order({ status }))).toBe(false);
    }
    expect(belongsToBuyoutQueue(order({ status: "IN_PROGRESS" }))).toBe(true);
  });

  test("WB-заказ никогда не считается неоплаченным прямым", () => {
    expect(isUnpaidDirect({ isDirectOrder: false, paidAt: null })).toBe(false);
  });

  test("prisma-фрагмент и SQL описывают одно правило", () => {
    expect(PAID_BUYOUT_SCOPE).toEqual({ NOT: { isDirectOrder: true, paidAt: null } });
    expect(PAID_BUYOUT_SQL).toBe(`NOT ("isDirectOrder" = true AND "paidAt" IS NULL)`);
  });
});
