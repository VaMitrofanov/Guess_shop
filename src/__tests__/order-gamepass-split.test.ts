import {
  buildSplitParts,
  assertSplitCoversOrder,
  suggestEqualSplit,
  nextUnpurchasedPart,
  splitIsComplete,
  splitChargedTotal,
  partPriceMatches,
  parseSplitGamepassId,
  SplitError,
  MAX_SPLIT_PARTS,
} from "@/lib/order-gamepass-split";

/**
 * Разбиение заменяет собой прайс-гард заказа, поэтому его инварианты — это
 * инварианты денег. Заказ на 3000 R$, закрытый тремя пассами по 1000, обязан
 * стоить ровно столько же, сколько закрытый одним пассом на 3000.
 */
describe("разбиение выкупа на несколько геймпассов", () => {
  const three1k = [
    { gamepassId: "1908301100", amount: 1000 },
    { gamepassId: "1546737712", amount: 1000 },
    { gamepassId: "1431718537", amount: 1000 },
  ];

  it("живой случай: 3000 R$ тремя пассами по 1000, цена каждого 1429", () => {
    const parts = buildSplitParts(three1k, 3000);
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.expectedPrice)).toEqual([1429, 1429, 1429]);
    expect(parts.map((p) => p.position)).toEqual([0, 1, 2]);
    expect(parts[0].gamepassUrl).toBe("https://www.roblox.com/game-pass/1908301100");
  });

  it("сумма частей обязана совпасть с номиналом — без допуска", () => {
    // Допуск здесь означал бы, что покупатель систематически получает не то
    // количество робуксов, за которое заплатил.
    expect(() => buildSplitParts(three1k, 2999)).toThrow(SplitError);
    expect(() => buildSplitParts(three1k, 2999)).toThrow(/лишние 1 R\$/);
    expect(() => buildSplitParts(three1k, 3001)).toThrow(/не хватает 1 R\$/);
  });

  it("один пасс дважды — отказ: это двойное списание и AlreadyOwned со второго раза", () => {
    expect(() => buildSplitParts(
      [{ gamepassId: "111222333", amount: 1500 }, { gamepassId: "111222333", amount: 1500 }],
      3000,
    )).toThrow(/указан дважды/);
  });

  it("одна часть — не разбиение, а обычная привязка", () => {
    expect(() => buildSplitParts([{ gamepassId: "111222333", amount: 3000 }], 3000)).toThrow(/от двух/);
  });

  it("границы: пустой список, слишком много частей, мусорный номинал", () => {
    expect(() => buildSplitParts([], 3000)).toThrow(/список/);
    const many = Array.from({ length: MAX_SPLIT_PARTS + 1 }, (_, i) => ({ gamepassId: `10000000${i}`, amount: 100 }));
    expect(() => buildSplitParts(many, 100 * many.length)).toThrow(/Максимум/);
    expect(() => buildSplitParts(
      [{ gamepassId: "111222333", amount: 2 }, { gamepassId: "444555666", amount: 2998 }],
      3000,
    )).toThrow(/номинал/);
  });

  it("принимает и ID, и ссылку — админ копирует то, что под рукой", () => {
    expect(parseSplitGamepassId("1908301100")).toBe("1908301100");
    expect(parseSplitGamepassId("https://www.roblox.com/game-pass/1908301100/Eeee")).toBe("1908301100");
    expect(parseSplitGamepassId("https://www.roblox.com/ru/game-passes/1908301100")).toBe("1908301100");
    expect(parseSplitGamepassId("не ссылка")).toBeNull();
    expect(parseSplitGamepassId("12")).toBeNull();
  });

  it("равные части: остаток уходит в первую, сумма сходится всегда", () => {
    expect(suggestEqualSplit(3000, 3)).toEqual([1000, 1000, 1000]);
    const odd = suggestEqualSplit(1000, 3);
    expect(odd).toEqual([334, 333, 333]);
    expect(odd.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(() => assertSplitCoversOrder(odd.map((amount) => ({ amount })), 1000)).not.toThrow();
    expect(suggestEqualSplit(20, 3)).toEqual([]);
  });

  it("части покупаются по порядку, заказ закрывается только целиком", () => {
    const parts = [
      { id: "b", gamepassId: "2", amount: 1000, position: 1, chargedPrice: null, purchasedAt: null },
      { id: "a", gamepassId: "1", amount: 1000, position: 0, chargedPrice: 1429, purchasedAt: new Date() },
      { id: "c", gamepassId: "3", amount: 1000, position: 2, chargedPrice: null, purchasedAt: null },
    ];
    expect(nextUnpurchasedPart(parts)?.id).toBe("b");
    expect(splitIsComplete(parts)).toBe(false);

    const done = parts.map((p) => ({ ...p, chargedPrice: 1429, purchasedAt: new Date() }));
    expect(nextUnpurchasedPart(done)).toBeNull();
    expect(splitIsComplete(done)).toBe(true);
    // Себестоимость заказа — сумма списаний, а не одно из них.
    expect(splitChargedTotal(done)).toBe(4287);
  });

  it("цена части сверяется с её номиналом, а не с номиналом заказа", () => {
    const part = { amount: 1000 };
    expect(partPriceMatches(part, 1429).ok).toBe(true);
    expect(partPriceMatches(part, 1429, 1429).ok).toBe(true);
    // 4286 — цена пасса на весь заказ: для части это чужая цена.
    expect(partPriceMatches(part, 4286).ok).toBe(false);
    expect(partPriceMatches(part, 1429).expected).toBe(1429);
    // Регион/скидка: валидируем базовую цену продавца, а не персональную.
    expect(partPriceMatches(part, 1200, 1429).ok).toBe(true);
    expect(partPriceMatches(part, 1429, 1200).ok).toBe(false);
  });
});
