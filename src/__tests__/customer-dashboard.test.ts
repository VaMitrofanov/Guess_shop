import {
  buildCustomerNotices,
  customerOrderStatus,
  orderRecordLabel,
  paymentAttemptLabel,
} from "@/lib/customer-dashboard";

describe("customer dashboard presentation", () => {
  test("does not confuse the canonical buyout queue with legacy awaiting payment", () => {
    expect(customerOrderStatus("canonical", "PENDING").label).toBe("В очереди на выкуп");
    expect(customerOrderStatus("legacy", "PENDING").label).toBe("Ожидает оплаты");
  });

  test("maps payment attempts to customer-safe labels", () => {
    expect(paymentAttemptLabel("CONFIRMED")).toBe("Оплата подтверждена");
    expect(paymentAttemptLabel("REFUNDED")).toBe("Возвращён");
    expect(paymentAttemptLabel(null)).toBe("Не создавался");
  });

  test.each([[1, "1 запись"], [2, "2 записи"], [5, "5 записей"], [11, "11 записей"], [21, "21 запись"]])(
    "pluralizes %i dashboard records",
    (count, expected) => expect(orderRecordLabel(count)).toBe(expected),
  );

  test("prioritizes customer actions and keeps the feed bounded", () => {
    const notices = buildCustomerNotices({
      orders: [
        { id: "a", kind: "canonical", status: "AWAITING_GAMEPASS", amountRobux: 500, createdAt: new Date("2026-07-15T10:00:00Z") },
        { id: "b", kind: "canonical", status: "ERROR", amountRobux: 1000, createdAt: new Date("2026-07-15T09:00:00Z") },
        { id: "c", kind: "canonical", status: "PENDING", amountRobux: 2000, createdAt: new Date("2026-07-15T08:00:00Z") },
      ],
      balance: 100,
      bonusExpiresAt: new Date("2026-07-18T00:00:00Z"),
      linkedProviders: [],
      now: new Date("2026-07-15T00:00:00Z"),
    });

    expect(notices).toHaveLength(4);
    expect(notices[0]).toMatchObject({ id: "gamepass:a", title: "Нужен геймпасс" });
    expect(notices[1]).toMatchObject({ id: "problem:b", tone: "danger" });
    expect(notices.some((notice) => notice.id === "bonus-expiry")).toBe(true);
  });
});
