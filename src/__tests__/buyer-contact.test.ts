jest.mock("../../bots/shared/db", () => ({ db: {} }));

import {
  classifyBuyerMessage,
  contactQuote,
  extractBuyerHints,
  findOrderByBuyerHints,
  isWbReplyEcho,
  orderCodePinText,
  summarizeRush,
  type BuyerContact,
} from "../../bots/shared/buyer-contact";
import { runBuyerContactSweep } from "../../bots/shared/buyer-contact-sweep";
import { problemHoldReason } from "../../bots/shared/order-hold";

describe("classifyBuyerMessage — живые сообщения 30.10–01.11.2026", () => {
  it.each([
    ["отказ. отменяйте выкуп робуксов и возвращайте деньги", "cancel"],
    ["Ребенку ничего не пришло , верните деньги", "cancel"],
    ["Можете сделать возврат пожалуйста?", "cancel"],
    ["Как вернуть? Так как не смогли активировать", "cancel"],
    ["где мои робуксы???", "rush"],
    ["как долго ждать", "rush"],
    ["когда придут", "rush"],
    ["Где второй код и ссылка?", "human"],
    ["не получается создать пасс", "human"],
    ["Вроде получилось", "quiet"],
    ["спасибо", "quiet"],
  ])("%s → %s", (text, kind) => {
    expect(classifyBuyerMessage(text)).toBe(kind);
  });

  it("кнопка «Статус» без текста — это «торопят»", () => {
    expect(classifyBuyerMessage(null, { contextKey: "status" })).toBe("rush");
  });

  it("до менеджера дошёл нарочно — «торопят», а в чате WB «Здравствуйте» — нет", () => {
    expect(classifyBuyerMessage("Здравствуйте", { viaSupport: true })).toBe("rush");
    expect(classifyBuyerMessage("Здравствуйте")).toBe("quiet");
  });

  it("служебная строка WB и присланный ник — не обращение", () => {
    expect(classifyBuyerMessage("Чат с покупателем по товару 123456789")).toBe("quiet");
    expect(classifyBuyerMessage("Vasya_2010")).toBe("quiet");
  });

  it("эхо «[Ответ]» в чате WB распознаётся (там наш текст)", () => {
    expect(isWbReplyEcho("[Ответ]\n  Хамство Андрей, сегодня в 17:12\n  Статус\n\n✅ По заказу …")).toBe(true);
    expect(isWbReplyEcho("где заказ")).toBe(false);
  });
});

describe("summarizeRush", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  const c = (orderId: string, hoursAgo: number, kind: BuyerContact["kind"], text: string | null, channel: BuyerContact["channel"] = "WB"): BuyerContact =>
    ({ orderId, at: new Date(now.getTime() - hoursAgo * 3_600_000), channel, text, kind, via: channel === "WB" ? "chat" : "support" });

  it("считает только «торопят» за 48 ч, пустая кнопка не затирает цитату", () => {
    const rush = summarizeRush([
      c("a", 3, "rush", "где заказ?"),
      c("a", 2, "rush", null, "TG"),
      c("a", 60, "rush", "старое"),
      c("a", 1, "quiet", "спасибо"),
      c("b", 1, "human", "второй код"),
    ], now);
    expect(rush.get("a")).toMatchObject({ count: 2, channels: ["WB", "TG"], lastText: "где заказ?", lastVia: "chat" });
    expect(rush.has("b")).toBe(false);
  });
});

describe("поиск заказа без кода", () => {
  it("достаёт код в любом написании, пасс и ник", () => {
    expect(extractBuyerHints("ник: Vasya_2010, код gsr-9tnf https://www.roblox.com/game-pass/123456789/x")).toEqual({
      codes: ["GSR9TNF"], gamepassIds: ["123456789"], nicks: ["Vasya_2010"],
    });
    expect(extractBuyerHints("где мои робуксы").codes).toEqual([]);
  });

  it("находит заказ, только если он один", async () => {
    const one = { wbOrder: { findMany: jest.fn().mockResolvedValue([{ wbCode: "GSR9TNF", amount: 500 }]) } };
    await expect(findOrderByBuyerHints(one, extractBuyerHints("Vasya_2010"))).resolves.toEqual({ wbCode: "GSR9TNF", amount: 500, by: "nick" });
    const two = { wbOrder: { findMany: jest.fn().mockResolvedValue([{ wbCode: "A", amount: 1 }, { wbCode: "B", amount: 1 }]) } };
    await expect(findOrderByBuyerHints(two, extractBuyerHints("Vasya_2010"))).resolves.toBeNull();
  });
});

describe("тексты покупателю", () => {
  it("закреп называет код и не называет номер заказа WB", () => {
    const text = orderCodePinText("GSR9TNF", 500, "plain");
    expect(text).toContain("Код вашего заказа: GSR9TNF");
    expect(text).not.toMatch(/номер/i);
  });

  it("цитата — одна строка с обрезкой", () => {
    expect(contactQuote("a\n\nb   c")).toBe("a b c");
    expect(contactQuote("x".repeat(200), 10)).toHaveLength(10);
  });
});

describe("runBuyerContactSweep", () => {
  const contactRow = (over: Record<string, unknown>) => ({
    sourceId: "ev1", orderId: "o1", at: new Date("2026-11-01T10:00:00Z"), channel: "WB",
    text: "верните деньги", contextKey: null, viaSupport: false,
    wbCode: "E5G3VPR", amount: 500, buyerName: "Анна", wbOrderId: "6170000000", ...over,
  });

  function fakeDb(rows: unknown[], opts: { duplicate?: boolean; completed?: boolean } = {}) {
    return {
      wbSyncCursor: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
      $queryRawUnsafe: jest.fn().mockResolvedValue(rows),
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      riskEvent: {
        create: opts.duplicate ? jest.fn().mockRejectedValue(new Error("P2002")) : jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      wbOrder: {
        findUnique: jest.fn().mockResolvedValue({ status: opts.completed ? "COMPLETED" : "PENDING", heldAt: null, adminNote: null, id: "o1" }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderHold: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(undefined)),
    };
  }

  it("просьба вернуть деньги: только отметка, без заморозки и пуша", async () => {
    const db = fakeDb([contactRow({}), contactRow({ sourceId: "ev2", text: "отказ, отмените заказ" })]);
    const res = await runBuyerContactSweep(db, new Date("2026-11-01T12:00:00Z"));
    expect(res.cancel).toBe(2);
    expect(db.riskEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "BUYER_CANCEL", dedupeKey: "buyer-cancel:ev1", action: "none" }) });
    expect(db.orderHold.upsert).not.toHaveBeenCalled();
    expect(db.wbOrder.update).not.toHaveBeenCalled();
    expect(db.wbOrder.updateMany).not.toHaveBeenCalled();
  });

  it("уже записанное сообщение повторно не считается", async () => {
    const db = fakeDb([contactRow({})], { duplicate: true });
    const res = await runBuyerContactSweep(db);
    expect(res.cancel).toBe(0);
  });

  it("«нужен человек» — в «Риски» без пуша", async () => {
    const db = fakeDb([contactRow({ text: "где второй код?" })]);
    const res = await runBuyerContactSweep(db);
    expect(res.help).toBe(1);
    expect(db.riskEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ kind: "BUYER_HELP" }) });
  });

  it("причина заморозки начинается с метки, по которой блок рисует 🛑", () => {
    expect(problemHoldReason("BUYER_REFUND_REQUEST", "верните деньги")).toBe("Покупатель просит отмену и возврат денег: «верните деньги»");
  });
});
