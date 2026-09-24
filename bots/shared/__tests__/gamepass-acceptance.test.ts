import {
  acceptGamepasses,
  intentPartsRows,
  normalizeParts,
  type AcceptanceDetails,
} from "../gamepass-acceptance";

/**
 * Одно правило приёма пассов на все входы: гейт ВБ, касса сайта, прямой заказ
 * ботов. Эталон — гейт коридора ВБ (решение владельца 21.09.2026: для выкупа
 * нужен только Pass ID; получатель — владелец пасса).
 */

const live = (map: Record<string, AcceptanceDetails>) => async (id: string) => map[id] ?? null;
const pass = (price: number, creatorName = "Owner", creatorId: number | string = 7): AcceptanceDetails => ({
  price,
  isActive: true,
  creatorId,
  creatorName,
});

describe("форма набора", () => {
  test("одна часть — обычный одиночный заказ, а не 400", () => {
    const res = normalizeParts("111", [{ gamepassId: "111", amount: 1000 }], 1000);
    expect(res).toEqual({ ok: true, parts: [{ gamepassId: "111", amount: 1000 }] });
  });

  test("сумма частей обязана совпасть ровно", () => {
    const res = normalizeParts("1", [{ gamepassId: "1", amount: 1500 }, { gamepassId: "2", amount: 500 }], 2037);
    expect(res.ok).toBe(false);
  });

  test("голова заказа — первая часть", () => {
    const res = normalizeParts("2", [{ gamepassId: "1", amount: 1500 }, { gamepassId: "2", amount: 500 }], 2000);
    expect(res).toMatchObject({ ok: false, code: "BAD_SPLIT" });
  });

  test("хвост заказа больше донора — законная часть (1700 = 1000 + 700)", () => {
    const res = normalizeParts("1", [{ gamepassId: "1", amount: 1000 }, { gamepassId: "2", amount: 700 }], 1700);
    expect(res.ok).toBe(true);
  });
});

describe("acceptGamepasses", () => {
  test("пасс нужной цены принимается, получатель — его владелец", async () => {
    const res = await acceptGamepasses({
      orderAmount: 1000,
      gamepassId: "1",
      claimedNick: "Owner",
      getDetails: live({ "1": pass(1429) }),
      onUnreachable: "reject",
    });
    expect(res).toMatchObject({ ok: true, split: false, recipient: "Owner", ownerSwitchedFrom: null });
  });

  test("пасс другого ника — не отказ, а смена получателя с пометкой", async () => {
    const res = await acceptGamepasses({
      orderAmount: 1000,
      gamepassId: "1",
      claimedNick: "Typed",
      getDetails: live({ "1": pass(1429, "RealOwner") }),
      onUnreachable: "accept",
    });
    expect(res).toMatchObject({ ok: true, recipient: "RealOwner", ownerSwitchedFrom: "Typed" });
  });

  test("цена каждой части сверяется с её номиналом, а не с заказом", async () => {
    const ok = await acceptGamepasses({
      orderAmount: 2000,
      gamepassId: "1",
      parts: [{ gamepassId: "1", amount: 1500 }, { gamepassId: "2", amount: 500 }],
      getDetails: live({ "1": pass(2143), "2": pass(715) }),
      onUnreachable: "reject",
    });
    expect(ok).toMatchObject({ ok: true, split: true });

    const wrong = await acceptGamepasses({
      orderAmount: 2000,
      gamepassId: "1",
      parts: [{ gamepassId: "1", amount: 1500 }, { gamepassId: "2", amount: 500 }],
      getDetails: live({ "1": pass(2143), "2": pass(700) }),
      onUnreachable: "reject",
    });
    expect(wrong).toMatchObject({ ok: false, code: "WRONG_PRICE", gamepassId: "2", expectedPrice: 715 });
  });

  test("снятый с продажи пасс не принимается", async () => {
    const res = await acceptGamepasses({
      orderAmount: 1000,
      gamepassId: "1",
      getDetails: live({ "1": { price: 1429, isActive: false } }),
      onUnreachable: "accept",
    });
    expect(res).toMatchObject({ ok: false, code: "NOT_FOR_SALE" });
  });

  test("набор из пассов разных аккаунтов не принимается — робуксы ушли бы разным людям", async () => {
    const res = await acceptGamepasses({
      orderAmount: 2000,
      gamepassId: "1",
      parts: [{ gamepassId: "1", amount: 1500 }, { gamepassId: "2", amount: 500 }],
      getDetails: live({ "1": pass(2143, "A", 1), "2": pass(715, "B", 2) }),
      onUnreachable: "accept",
    });
    expect(res).toMatchObject({ ok: false, code: "MIXED_OWNERS" });
  });

  test("Roblox молчит: ВБ и боты принимают без проверки, касса сайта просит повторить", async () => {
    const silent = async () => null;
    const wb = await acceptGamepasses({ orderAmount: 1000, gamepassId: "1", claimedNick: "Nick", getDetails: silent, onUnreachable: "accept" });
    expect(wb).toMatchObject({ ok: true, recipient: "Nick", unverified: ["1"] });

    const site = await acceptGamepasses({ orderAmount: 1000, gamepassId: "1", claimedNick: "Nick", getDetails: silent, onUnreachable: "reject" });
    expect(site).toMatchObject({ ok: false, code: "ROBLOX_UNAVAILABLE" });
  });

  test("владелец без имени достаётся по id", async () => {
    const res = await acceptGamepasses({
      orderAmount: 1000,
      gamepassId: "1",
      getDetails: live({ "1": { price: 1429, isActive: true, creatorId: 99 } }),
      resolveCreatorName: async (id) => (id === "99" ? "ById" : null),
      onUnreachable: "reject",
    });
    expect(res).toMatchObject({ ok: true, recipient: "ById" });
  });

  test("номинал неизвестен (код ВБ без номинала) — цену не сверяем, как и раньше", async () => {
    const res = await acceptGamepasses({ orderAmount: 0, gamepassId: "1", getDetails: live({ "1": pass(5) }), onUnreachable: "accept" });
    expect(res.ok).toBe(true);
  });
});

describe("intentPartsRows — набор из прямой заявки в строки заказа", () => {
  test("набор становится строками WbOrderGamepass по порядку", () => {
    const rows = intentPartsRows(
      [{ gamepassId: "1", amount: 1500 }, { gamepassId: "2", amount: 500 }],
      2000,
      "ord",
    );
    expect(rows).toEqual([
      { orderId: "ord", gamepassId: "1", gamepassUrl: "https://www.roblox.com/game-pass/1", amount: 1500, position: 0 },
      { orderId: "ord", gamepassId: "2", gamepassUrl: "https://www.roblox.com/game-pass/2", amount: 500, position: 1 },
    ]);
  });

  test("нет набора, одна часть или сумма не сходится — одиночный заказ", () => {
    expect(intentPartsRows(null, 2000, "ord")).toBeNull();
    expect(intentPartsRows([{ gamepassId: "1", amount: 2000 }], 2000, "ord")).toBeNull();
    expect(intentPartsRows([{ gamepassId: "1", amount: 1500 }, { gamepassId: "2", amount: 400 }], 2000, "ord")).toBeNull();
  });
});
