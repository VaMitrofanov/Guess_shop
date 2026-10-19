import { nextStepFor, sourceLabel, statusLabel, type PresentableOrder } from "@/lib/order-presentation";

const base: PresentableOrder = {
  amount: 800, status: "PENDING", wbCode: "TEST1", gamepassUrl: "https://www.roblox.com/game-pass/1",
  heldAt: null, isDirectOrder: false, orderSource: "WB", buyoutErrorCode: null,
  createdAt: new Date().toISOString(), pendingAt: null, robloxUsername: "nick",
};

describe("строка «Дальше»", () => {
  test("готовый к выкупу — выкупить с ценой пасса", () => {
    expect(nextStepFor(base)?.text).toMatch(/^выкупить пасс за 1[\s ]?143 R\$$/);
  });
  test("заморозка бьёт всё", () => {
    expect(nextStepFor({ ...base, heldAt: new Date().toISOString() })?.tone).toBe("ice");
  });
  test("ждёт ссылку: до трёх напоминаний ждём, после — дожимать", () => {
    const awaiting = { ...base, status: "AWAITING_GAMEPASS", gamepassUrl: null };
    expect(nextStepFor({ ...awaiting, remindersSent: 1 })?.text).toContain("1 из 3");
    expect(nextStepFor({ ...awaiting, remindersSent: 3 })?.text).toMatch(/^дожать вручную/);
  });
  test("цена не сходится — одна строка с двумя цифрами", () => {
    const next = nextStepFor(base, { priceMismatch: true, livePrice: 1000, expected: 1143, isForSale: true });
    expect(next?.tone).toBe("orange");
    expect(next?.text).toMatch(/1[\s ]?000 R\$.*1[\s ]?143 R\$/);
  });
  test("закрытым заказам дальше ничего", () => {
    expect(nextStepFor({ ...base, status: "COMPLETED" })).toBeNull();
    expect(nextStepFor({ ...base, status: "REJECTED" })).toBeNull();
  });
  test("неоплаченный прямой — ждём оплату", () => {
    expect(nextStepFor({ ...base, status: "AWAITING_PAYMENT", isDirectOrder: true })?.text).toMatch(/оплат/);
  });
});

describe("слова вместо enum", () => {
  test("статусы и источники", () => {
    expect(statusLabel("PENDING")).toBe("К выкупу");
    expect(statusLabel("AWAITING_GAMEPASS")).toBe("Ждёт ссылку");
    expect(sourceLabel("WB_DBS")).toMatch(/DBS/);
    expect(sourceLabel("WB_DBS")).not.toBe("WB_DBS");
    expect(statusLabel("НЕЧТО")).toBe("НЕЧТО");
  });
});
