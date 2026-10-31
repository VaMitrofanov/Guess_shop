import { appendOrderAudit, buildRestoreToBuyoutData, ORDER_NOTE_LIMIT } from "../lib/order-recovery";

const baseOrder = {
  status: "ERROR",
  wbCode: "ABC1234",
  gamepassUrl: "https://www.roblox.com/game-pass/123456",
  isDirectOrder: false,
  paidAt: null,
  adminNote: "Старая диагностика",
};

describe("buildRestoreToBuyoutData", () => {
  test("возвращает ERROR-заказ с геймпассом в PENDING и сохраняет историю", () => {
    const now = new Date("2026-07-14T08:00:00.000Z");
    const result = buildRestoreToBuyoutData(baseOrder, "Admin", now);

    expect(result).toEqual({
      ok: true,
      data: {
        status: "PENDING",
        buyoutErrorCode: null,
        pendingAt: now,
        adminNote: "Старая диагностика\n[ВОЗВРАТ 2026-07-14 от Admin] ERROR→PENDING, геймпасс сохранён",
      },
    });
  });

  test("не возвращает заказ без геймпасса", () => {
    const result = buildRestoreToBuyoutData({ ...baseOrder, gamepassUrl: null }, "Admin");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  test("не обходит оплату прямого заказа", () => {
    const result = buildRestoreToBuyoutData({ ...baseOrder, isDirectOrder: true }, "Admin");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("не оплачен");
  });

  test("не меняет заказ вне ERROR", () => {
    const result = buildRestoreToBuyoutData({ ...baseOrder, status: "PENDING" }, "Admin");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

describe("appendOrderAudit", () => {
  test("добавляет строку и не дублирует её", () => {
    expect(appendOrderAudit("один", "два")).toBe("один\nдва");
    expect(appendOrderAudit("один\nдва", "два")).toBe("один\nдва");
  });

  test("при переполнении сохраняет свежий хвост заметки", () => {
    const result = appendOrderAudit("x".repeat(ORDER_NOTE_LIMIT), "новая запись");
    expect(result).toHaveLength(ORDER_NOTE_LIMIT);
    expect(result.endsWith("новая запись")).toBe(true);
  });
});
