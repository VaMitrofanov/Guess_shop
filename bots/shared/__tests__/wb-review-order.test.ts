jest.mock("../db", () => ({ db: {} }));
jest.mock("../buyer-identity", () => ({ identityLinesFor: async () => ["👤 Ольга · TG · 2-й заказ"] }));

import { reviewOrderInfo } from "../wb-review-order";

const at = "2026-11-20T17:34:17Z";
const fakeDb = (rows: unknown[], order: unknown) => ({
  wbMarketplaceOrder: { findMany: async () => rows },
  wbOrder: { findUnique: async () => order },
});

describe("чей отзыв: заказ по времени заказа WB (27.11.2026)", () => {
  it("находит заказ, даёт копируемый код и кто это", async () => {
    const db = fakeDb([
      { id: "m1", nmId: 967446616, wbOrderId: "6320000001", wbCreatedAt: new Date(Date.parse(at) + 60_000), firstSeenAt: new Date(at), buyerName: "Ольга", claimOpenedAt: null, cancelledAt: null, wbCode: { code: "ABC1234" } },
      { id: "m2", nmId: 967446616, wbOrderId: "6320000002", wbCreatedAt: new Date(Date.parse(at) + 9 * 60_000), firstSeenAt: new Date(at), buyerName: "Иван", claimOpenedAt: null, cancelledAt: null, wbCode: { code: "ZZZ9999" } },
    ], { amount: 500, status: "COMPLETED", completedAt: new Date("2026-11-21T10:00:00Z"), robloxUsername: "kid_2015", heldAt: null });
    const info = await reviewOrderInfo(db, { id: "f1", userName: "Ольга", productDetails: { nmId: 967446616 }, lastOrderCreatedAt: at, lastOrderShkId: 123456789 });
    expect(info.code).toBe("ABC1234");
    expect(info.lines[0]).toContain("<code>ABC1234</code>");
    expect(info.lines[0]).toContain("6320000001");
    expect(info.lines.join("\n")).toContain("kid_2015");
    expect(info.lines.join("\n")).toContain("123456789");
    expect(info.lines).toContain("👤 Ольга · TG · 2-й заказ");
    expect(info.context).toMatch(/выкуп/);
  });

  it("нет заказа в окне — так и пишет, с ШК", async () => {
    const info = await reviewOrderInfo(fakeDb([], null), { id: "f2", productDetails: { nmId: 1 }, lastOrderCreatedAt: at, lastOrderShkId: 42 });
    expect(info.code).toBeNull();
    expect(info.lines[0]).toMatch(/не найден/);
    expect(info.lines[0]).toContain("42");
  });
});
