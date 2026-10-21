import { nextStepFor, orderFlag, packDuplicates, primaryActionFor, readinessFor, sourceLabel, statusLabel, type PresentableOrder } from "@/lib/order-presentation";

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

describe("главное действие и живая проверка пасса (20.10)", () => {
  test("пасс снят с продажи — не «Выкуплено», а «Написать»", () => {
    expect(primaryActionFor(base, { isForSale: false })?.kind).toBe("contact");
  });
  test("пасс уже покупали в закрытом заказе — «Выкуплено» остаётся, флага нет: это справка (21.10, 3FBF66L)", () => {
    expect(primaryActionFor(base, { reusedIn: "OTHER1" })?.action).toBe("complete");
    expect(orderFlag(base, { reusedIn: "OTHER1" })?.text ?? "").not.toMatch(/OTHER1/);
    expect(nextStepFor(base, { reusedIn: "OTHER1" })?.tone).toBe("green");
  });
  test("тот же пасс у двух заказов одной очереди — оранжевое «с другого аккаунта»", () => {
    expect(orderFlag(base, null, 0, { packDupIn: "TWIN1" })).toEqual(expect.objectContaining({ tone: "orange" }));
    expect(nextStepFor(base, null, 0, { packDupIn: "TWIN1" })?.text).toMatch(/другого аккаунта.*TWIN1/);
    expect(primaryActionFor(base)?.action).toBe("complete");
  });
  test("без живой проверки или при годном пассе — «Выкуплено»", () => {
    expect(primaryActionFor(base)?.action).toBe("complete");
    expect(primaryActionFor(base, { isForSale: true, priceMismatch: false })?.action).toBe("complete");
  });
});

describe("повтор пасса внутри очереди", () => {
  const row = (id: string, pass: string, status = "PENDING", heldAt: string | null = null) =>
    ({ id, wbCode: `C${id}`, status, heldAt, pass });
  test("пара с одним пассом подсвечивает друг друга, закрытый и замороженный не в счёт", () => {
    const dup = packDuplicates(
      [row("1", "77"), row("2", "77"), row("3", "88"), row("4", "88", "COMPLETED"), row("5", "88", "PENDING", "x")],
      o => [o.pass],
    );
    expect(dup.get("1")).toBe("C2");
    expect(dup.get("2")).toBe("C1");
    expect(dup.has("3")).toBe(false);
  });
});

describe("готовность к выкупу", () => {
  test("пасс есть и годен — «Готов к выкупу», шаг выкупа текущий", () => {
    const r = readinessFor(base, { isForSale: true });
    expect(r.ready).toBe(true);
    expect(r.label).toBe("Готов к выкупу");
    expect(r.steps).toEqual(["done", "done", "done", "now"]);
  });
  test("ждёт пасс — оранжевое «Ждём пасс», не готов", () => {
    const r = readinessFor({ ...base, status: "AWAITING_GAMEPASS", gamepassUrl: null, robloxUsername: null });
    expect(r.ready).toBe(false);
    expect(r.label).toBe("Ждём пасс");
    expect(r.steps[2]).toBe("wait");
  });
  test("пасс снят — шаг пасса плохой, выкупать нельзя", () => {
    const r = readinessFor(base, { isForSale: false });
    expect(r.ready).toBe(false);
    expect(r.steps[2]).toBe("bad");
  });
  test("разбитый заказ: доля выкупленных частей в шаге «Выкуп»", () => {
    const r = readinessFor({ ...base, splitGamepasses: [{ purchasedAt: "x" }, { purchasedAt: null }] });
    expect(r.label).toBe("Выкуп · 1 из 2");
    expect(r.buyoutShare).toBe(0.5);
  });
  test("заморожен и выкуплен — не «готов»", () => {
    expect(readinessFor({ ...base, heldAt: "x" }).ready).toBe(false);
    expect(readinessFor({ ...base, status: "COMPLETED" }).steps).toEqual(["done", "done", "done", "done"]);
  });
});
