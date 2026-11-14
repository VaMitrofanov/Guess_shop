import {
  ageBasis, ageTone, canComplete, fmtAge, grossOf, isHeld, laneOf,
  orderBadge, orderFlag, primaryActionFor, type PresentableOrder,
} from "@/lib/order-presentation";

const base: PresentableOrder = {
  amount: 1000,
  status: "PENDING",
  wbCode: "ZZF7T5B",
  gamepassUrl: "https://www.roblox.com/game-pass/1907029789",
  heldAt: null,
  isDirectOrder: false,
  orderSource: "WB_DBS",
  buyoutErrorCode: null,
  createdAt: new Date(Date.now() - 9 * 3600_000).toISOString(),
  pendingAt: new Date(Date.now() - 4 * 3600_000).toISOString(),
  robloxUsername: "Anastasia_M",
};

const order = (patch: Partial<PresentableOrder> = {}): PresentableOrder => ({ ...base, ...patch });

describe("грязные и чистые робуксы", () => {
  it("грязные = чистые ÷ 0,7 с округлением вверх", () => {
    expect(grossOf(1000)).toBe(1429);
    expect(grossOf(500)).toBe(715);
    expect(grossOf(2000)).toBe(2858);
  });
});

describe("возраст", () => {
  it("в очереди выкупа считается от попадания в неё, а не от создания", () => {
    expect(ageBasis(order())).toBe(base.pendingAt);
    expect(ageBasis(order({ status: "AWAITING_GAMEPASS" }))).toBe(base.createdAt);
  });

  it("красится по порогам, а не по вкусу экрана", () => {
    const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
    expect(ageTone(ago(1))).toBe("green");
    expect(ageTone(ago(6))).toBe("yellow");
    expect(ageTone(ago(20))).toBe("orange");
    expect(ageTone(ago(48))).toBe("red");
    expect(ageTone(null)).toBe("muted");
  });

  it("формат компактный и без склонений", () => {
    expect(fmtAge(new Date(Date.now() - 40 * 60_000).toISOString())).toBe("40 мин");
    expect(fmtAge(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe("3ч");
    expect(fmtAge(null)).toBe("—");
  });
});

describe("заморозка бьёт статус", () => {
  const held = order({ heldAt: new Date().toISOString(), heldReason: "спор по заказу на WB" });

  it("бейдж и главное действие говорят только про разморозку", () => {
    expect(orderBadge(held)).toEqual({ label: "❄️ Заморожен", tone: "ice" });
    expect(primaryActionFor(held)).toMatchObject({ action: "unhold", tone: "ice" });
  });

  it("выкупить замороженный заказ нельзя ни одним путём", () => {
    expect(canComplete(held)).toBe(false);
    expect(isHeld(held)).toBe(true);
  });

  it("причина заморозки уходит во флаг", () => {
    expect(orderFlag(held)?.text).toContain("спор по заказу на WB");
  });
});

describe("главное действие определяется состоянием, а не срезом", () => {
  it("PENDING с пассом закрывается «Выкуплено»", () => {
    expect(primaryActionFor(order())).toMatchObject({ action: "complete", label: "Выкуплено" });
    expect(canComplete(order())).toBe(true);
  });

  it("ошибка с пассом возвращается в очередь, без пасса — не предлагает ничего", () => {
    expect(primaryActionFor(order({ status: "ERROR" }))).toMatchObject({ action: "restore-to-buyout", label: "Вернуть" });
    expect(primaryActionFor(order({ status: "ERROR", gamepassUrl: null }))).toBeNull();
  });

  it("без пасса выкупать нечего — только написать клиенту", () => {
    expect(primaryActionFor(order({ status: "AWAITING_GAMEPASS", gamepassUrl: null }))).toMatchObject({ kind: "contact" });
  });

  it("прямой заказ до оплаты не закрывается и не выкупается", () => {
    expect(primaryActionFor(order({ status: "AWAITING_PAYMENT", isDirectOrder: true }))).toBeNull();
    expect(primaryActionFor(order({ status: "PAYMENT_PENDING", isDirectOrder: true }))).toBeNull();
  });

  it("закрытый заказ действий не предлагает", () => {
    expect(primaryActionFor(order({ status: "COMPLETED" }))).toBeNull();
    expect(primaryActionFor(order({ status: "REJECTED" }))).toBeNull();
  });

  it("разбитый заказ закрывается только последней частью", () => {
    const partial = order({ splitGamepasses: [{ purchasedAt: new Date().toISOString() }, { purchasedAt: null }] });
    expect(primaryActionFor(partial)).toBeNull();
    const full = order({ splitGamepasses: [{ purchasedAt: new Date().toISOString() }, { purchasedAt: new Date().toISOString() }] });
    expect(primaryActionFor(full)).toMatchObject({ action: "complete" });
  });
});

describe("строка-флаг: порядок веток = порядок срочности", () => {
  it("рег. цена важнее всего остального", () => {
    const flag = orderFlag(order({ buyoutErrorCode: "REGIONAL_PRICE" }), { isForSale: false });
    expect(flag).toMatchObject({ tone: "red" });
    expect(flag?.text).toContain("рег. цена");
  });

  it("снятый пасс важнее расхождения цены", () => {
    expect(orderFlag(order(), { isForSale: false, priceMismatch: true, livePrice: 1500 })?.text).toContain("снят с продажи");
  });

  it("расхождение цены называет обе цифры", () => {
    const flag = orderFlag(order(), { isForSale: true, priceMismatch: true, livePrice: 1500, expected: 1429 });
    expect(flag?.tone).toBe("orange");
    // ru-RU разделяет разряды неразрывным пробелом — сверяемся тем же форматом.
    expect(flag?.text).toContain((1500).toLocaleString("ru-RU"));
    expect(flag?.text).toContain((1429).toLocaleString("ru-RU"));
  });

  it("зелёная строка без живой проверки не появляется", () => {
    expect(orderFlag(order())).toBeNull();
    expect(orderFlag(order(), { isForSale: true, priceMismatch: false })?.tone).toBe("green");
  });

  it("прогресс частей показывается только там, где его попросили", () => {
    const partial = order({ splitGamepasses: [{ purchasedAt: new Date().toISOString() }, { purchasedAt: null }] });
    expect(orderFlag(partial)).toBeNull();
    expect(orderFlag(partial, null, 0, { splitProgress: true })?.text).toContain("куплено 1 из 2");
  });

  it("молчание бота после трёх напоминаний названо словами", () => {
    expect(orderFlag(order({ status: "AWAITING_GAMEPASS", gamepassUrl: null }), null, 3)?.text).toContain("три напоминания");
  });
});

describe("полоса источника", () => {
  it("DBS, прямой и обычный ВБ различаются", () => {
    expect(laneOf({ orderSource: "WB_DBS", isDirectOrder: false })).toBe("WB_DBS");
    expect(laneOf({ orderSource: "DIRECT", isDirectOrder: true })).toBe("DIRECT");
    expect(laneOf({ orderSource: "WB", isDirectOrder: false })).toBe("WB");
  });
});
