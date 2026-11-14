import { orderPinStage, orderPinText, syncOrderPins } from "../order-pin";

describe("orderPinStage", () => {
  it("раскладывает статусы по стадиям", () => {
    expect(orderPinStage("AWAITING_GAMEPASS")).toBe("wait");
    expect(orderPinStage("PENDING")).toBe("queue");
    expect(orderPinStage("IN_PROGRESS")).toBe("queue");
    expect(orderPinStage("COMPLETED")).toBe("done");
    expect(orderPinStage("CANCELLED")).toBeNull();
  });
});

describe("orderPinText", () => {
  it("выкупленный — без срока Pending и без номера заказа WB", () => {
    const text = orderPinText({ code: "GSR9TNF", amount: 500, stage: "done", completedAt: new Date("2026-11-11T10:00:00Z"), format: "plain" });
    expect(text).toContain("GSR9TNF");
    expect(text).toContain("Pending");
    expect(text).toContain("С нашей стороны всё готово");
    expect(text).not.toMatch(/номер|дн(я|ей)|до \d/i);
  });

  it("TG — код моноширинный", () => {
    expect(orderPinText({ code: "AAA1111", amount: 1000, stage: "queue", format: "html" })).toContain("<code>AAA1111</code>");
  });
});

describe("syncOrderPins", () => {
  const row = (stage: string, status: string) => ({
    orderId: "o1", payload: { platform: "TG", chatId: "42", messageId: 7, stage },
    status, code: "AAA1111", amount: 500, completedAt: null,
  });
  const mkDb = (rows: unknown[]) => ({
    $queryRawUnsafe: jest.fn().mockResolvedValue(rows),
    orderEvent: { create: jest.fn().mockResolvedValue({}) },
    wbOrder: {},
  });

  it("правит закреп, когда стадия ушла вперёд, и запоминает новую", async () => {
    const db = mkDb([row("wait", "PENDING")]);
    const apply = jest.fn().mockResolvedValue({});
    await expect(syncOrderPins(db as never, "TG", apply)).resolves.toBe(1);
    expect(apply.mock.calls[0][1]).toContain("очереди выкупа");
    expect(db.orderEvent.create.mock.calls[0][0].data.payload).toMatchObject({ stage: "queue", messageId: 7 });
  });

  it("не трогает ту же стадию и не откатывает назад", async () => {
    const db = mkDb([row("queue", "PENDING"), { ...row("done", "PENDING"), orderId: "o2" }]);
    const apply = jest.fn();
    await expect(syncOrderPins(db as never, "TG", apply)).resolves.toBe(0);
    expect(apply).not.toHaveBeenCalled();
  });

  it("не вышло — событие не пишем, повторим позже", async () => {
    const db = mkDb([row("wait", "COMPLETED")]);
    await expect(syncOrderPins(db as never, "TG", jest.fn().mockRejectedValue(new Error("x")))).resolves.toBe(0);
    expect(db.orderEvent.create).not.toHaveBeenCalled();
  });
});
