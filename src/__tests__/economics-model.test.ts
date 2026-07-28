import {
  computeOrder, computeTotals, costKopFor, grossFor, modelPriceKop, ratesValid,
  type EconomicsOrder, type EconomicsRates,
} from "@/lib/economics-model";

/**
 * Формула экономики — единственная на две админки (TWA и веб). Тест держит её
 * инварианты: комиссия Roblox накручивается ДО денег, бонус считается за наш
 * счёт, а заказ без известной цены не участвует в прибыли.
 */

const RATES: EconomicsRates = { usdToRub: 85, rateUsdPer1k: 4.3, taxPct: 30 };
const PRICES: Record<number, number> = { 100: 160, 200: 260, 500: 450, 1000: 800 };

const order = (over: Partial<EconomicsOrder> = {}): EconomicsOrder => ({
  id: "o1", wbCode: "DIR-TEST", source: "DIRECT", platform: "TG", robloxUsername: "nick",
  robuxDelivered: 200, bonusRobux: 0, bonusSource: "order",
  revenueKopecks: 26_000, revenueSource: "order",
  costSnapshotKopecks: null, grossSnapshotRobux: null,
  rateSnapshotUsdPer1k: null, usdToRubSnapshot: null,
  paid: true, createdAt: "2026-07-27T00:00:00.000Z", completedAt: "2026-07-28T00:00:00.000Z",
  ...over,
});

describe("ratesValid", () => {
  it("отвергает комиссию 100% — она обнулила бы чистые робуксы", () => {
    expect(ratesValid({ ...RATES, taxPct: 100 })).toBe(false);
    expect(ratesValid({ ...RATES, taxPct: 99 })).toBe(true);
  });

  it("отвергает нулевой курс и нулевую ставку", () => {
    expect(ratesValid({ ...RATES, usdToRub: 0 })).toBe(false);
    expect(ratesValid({ ...RATES, rateUsdPer1k: 0 })).toBe(false);
  });
});

describe("grossFor / costKopFor", () => {
  it("накручивает комиссию Roblox вверх, а не вниз", () => {
    // Чтобы клиент получил 1000, купить надо 1429 — не 700.
    expect(grossFor(1000, RATES)).toBe(1429);
    expect(grossFor(200, RATES)).toBe(286);
  });

  it("считает себестоимость от грязных робуксов", () => {
    // 1429 / 1000 × 4.3 $ × 85 ₽ = 522.30 ₽
    expect(costKopFor(1429, RATES)).toBe(52_230);
  });

  it("при негодных курсах возвращает нули, а не NaN", () => {
    const broken = { ...RATES, usdToRub: 0 };
    expect(grossFor(1000, broken)).toBe(0);
    expect(costKopFor(1429, broken)).toBe(0);
  });
});

describe("modelPriceKop", () => {
  it("берёт цену из прайса, когда пак в нём есть", () => {
    expect(modelPriceKop(1000, PRICES)).toBe(80_000);
  });

  it("нестандартный объём считает по той же лесенке, что бот", () => {
    // 300 R$: ставка 1 ₽/R$ + надбавка 60 ₽ за малый заказ.
    expect(modelPriceKop(300, PRICES)).toBe(36_000);
    // 800 R$: ставка 0.9 ₽/R$, надбавки нет.
    expect(modelPriceKop(800, PRICES)).toBe(72_000);
  });
});

describe("computeOrder", () => {
  it("считает прибыль как выручку минус себестоимость грязных", () => {
    const r = computeOrder(order(), RATES, PRICES);
    expect(r.gross).toBe(286);
    expect(r.costKop).toBe(10_453);
    expect(r.profitKop).toBe(26_000 - 10_453);
  });

  it("бонусные робуксы покупаем мы: они входят в грязные и в себестоимость", () => {
    const withBonus = computeOrder(order({ robuxDelivered: 200, bonusRobux: 100, revenueKopecks: 16_000 }), RATES, PRICES);
    expect(withBonus.paidRobux).toBe(100);
    expect(withBonus.gross).toBe(286);              // грязные считаются от ВЫДАННОГО, не от оплаченного
    expect(withBonus.bonusCostKop).toBe(costKopFor(286, RATES) - costKopFor(143, RATES));
    // Модельная выручка берётся от оплаченной части — клиент платил за 100 R$.
    expect(withBonus.modelRevenueKop).toBe(16_000);
  });

  it("без известной цены прибыль равна null, а не нулю", () => {
    const r = computeOrder(order({ revenueKopecks: null, revenueSource: "unknown" }), RATES, PRICES);
    expect(r.profitKop).toBeNull();
    expect(r.costKop).toBeGreaterThan(0);
  });
});

describe("computeTotals", () => {
  const rows = [
    computeOrder(order({ id: "a" }), RATES, PRICES),
    computeOrder(order({ id: "b", revenueKopecks: null, revenueSource: "unknown" }), RATES, PRICES),
  ];
  const t = computeTotals(rows);

  it("не даёт заказу без цены съесть маржу остальных", () => {
    expect(t.withRevenue).toBe(1);
    expect(t.profitKop).toBe(26_000 - 10_453);
    expect(t.knownCostKop).toBe(10_453);
    expect(t.costNoRevenueKop).toBe(10_453);
  });

  it("робуксы и себестоимость считает по ВСЕМ заказам, включая безденежные", () => {
    expect(t.orders).toBe(2);
    expect(t.delivered).toBe(400);
    expect(t.costKop).toBe(20_906);
  });

  it("маржа считается от выручки и только когда выручка есть", () => {
    expect(t.marginPct).toBe(Math.round((t.profitKop / t.revenueKop) * 100));
    expect(computeTotals([]).marginPct).toBeNull();
  });
});
