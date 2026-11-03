/**
 * Прайс-гард выкупа (PLAN-gp-price-guard): цена пасса обязана совпадать с
 * ожидаемой по номиналу заказа (±PRICE_TOL), продавец — с ником заказа.
 * Кейс-инцидент 2026-07-12: заказ на 500 (ожид 715) выкуплен за 1143.
 */
import {
  PRICE_TOL,
  classifyBuyerPrice,
  expectedGamepassPrice,
  checkGamepassPrice,
  hasRegionalPrice,
  sellerMatchesOrder,
} from "../lib/purchase-guard";

describe("expectedGamepassPrice — формула эталона автовыкупа", () => {
  test.each<[number, number]>([
    [500, 715],    // ceil(500/0.7) = 715 — кейс инцидента
    [800, 1143],   // ceil(800/0.7) = 1143
    [700, 1001],   // float: 700/0.7 = 1000.0000…1 → ceil 1001; так же считает весь прод
    [100, 143],
    [7, 10],
    [900, 1286],   // DIR: amount уже с бонусом (800 + 100)
  ])("amount=%p → expected=%p", (amount, expected) => {
    expect(expectedGamepassPrice(amount)).toBe(expected);
  });
});

describe("checkGamepassPrice — допуск ±PRICE_TOL", () => {
  test("точное совпадение — ок", () => {
    expect(checkGamepassPrice(500, 715)).toEqual({ ok: true, expected: 715 });
  });

  test(`+${PRICE_TOL} — ок (граница допуска)`, () => {
    expect(checkGamepassPrice(500, 715 + PRICE_TOL).ok).toBe(true);
    expect(checkGamepassPrice(500, 715 - PRICE_TOL).ok).toBe(true);
  });

  test(`+${PRICE_TOL + 1} — блок (за границей допуска)`, () => {
    expect(checkGamepassPrice(500, 715 + PRICE_TOL + 1).ok).toBe(false);
    expect(checkGamepassPrice(500, 715 - PRICE_TOL - 1).ok).toBe(false);
  });

  test("инцидент 2026-07-12: пасс 1143 при номинале 500 — блок", () => {
    const res = checkGamepassPrice(500, 1143);
    expect(res.ok).toBe(false);
    expect(res.expected).toBe(715);
  });

  test("тот же пасс 1143 при номинале 800 — ок (второй заказ инцидента)", () => {
    expect(checkGamepassPrice(800, 1143)).toEqual({ ok: true, expected: 1143 });
  });

  test("DIR с бонусом: amount=900 (800+100) ждёт пасс ровно за 1286", () => {
    expect(checkGamepassPrice(900, 1286).ok).toBe(true);
    expect(checkGamepassPrice(900, 1143).ok).toBe(false);
  });

  test("managed pricing: сверяется фактическое списание (PriceInRobux)", () => {
    // Без UserBasePriceInRobux старый/public контракт остаётся строгим.
    expect(checkGamepassPrice(500, 793).ok).toBe(false);
  });

  test("regional pricing: базовая цена отдельно валидирует номинал", () => {
    expect(checkGamepassPrice(1000, 1287, 1429)).toEqual({ ok: true, expected: 1429 });
  });

  test("regional pricing не маскирует неверную базовую цену", () => {
    expect(checkGamepassPrice(1000, 1287, 1143)).toEqual({ ok: false, expected: 1429 });
  });
});

describe("hasRegionalPrice — жёсткий стоп региональной цены", () => {
  test("любое отличие buyer price от base включает стоп", () => {
    expect(hasRegionalPrice(1287, 1429)).toBe(true);
    expect(hasRegionalPrice(1428, 1429)).toBe(true);
  });
  test("равная или отсутствующая base-цена не считается региональной", () => {
    expect(hasRegionalPrice(1429, 1429)).toBe(false);
    expect(hasRegionalPrice(1429, null)).toBe(false);
  });

  test.each([10, 20])("typed Roblox Plus %p%% разрешён", (percent) => {
    const base = 2858;
    const discount = Math.floor(base * percent / 100);
    const details = [{ Type: "RobloxPlusSubscription", Percent: percent, AmountInRobux: discount }];
    expect(hasRegionalPrice(base - discount, base, details)).toBe(false);
    expect(classifyBuyerPrice(base - discount, base, details)).toEqual({
      kind: "ROBLOX_PLUS",
      discountPercent: percent,
      discountAmount: discount,
    });
  });

  test("unknown, mixed и поддельная Plus-арифметика остаются заблокированы", () => {
    expect(hasRegionalPrice(2573, 2858, [{ Type: "RegionalPricing", Percent: 10, AmountInRobux: 285 }])).toBe(true);
    expect(hasRegionalPrice(2573, 2858, [
      { Type: "RobloxPlusSubscription", Percent: 10, AmountInRobux: 285 },
      { Type: "OtherDiscount", Percent: 1, AmountInRobux: 1 },
    ])).toBe(true);
    expect(hasRegionalPrice(2573, 2858, [{ Type: "RobloxPlusSubscription", Percent: 10, AmountInRobux: 284 }])).toBe(true);
  });
});

describe("sellerMatchesOrder — seller-check как в автовыкупе", () => {
  test("совпадение case-insensitive — ок", () => {
    expect(sellerMatchesOrder("CoolSeller", "coolseller")).toBe(true);
  });
  test("другой продавец — блок", () => {
    expect(sellerMatchesOrder("CoolSeller", "EvilTwin")).toBe(false);
  });
  test("нет ника в заказе или создателя в info — не блокируем", () => {
    expect(sellerMatchesOrder(null, "Somebody")).toBe(true);
    expect(sellerMatchesOrder("Somebody", null)).toBe(true);
    expect(sellerMatchesOrder(undefined, undefined)).toBe(true);
  });
});
