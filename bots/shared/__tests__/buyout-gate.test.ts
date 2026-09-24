/**
 * Гейт выкупа: два правила владельца (21.09.2026).
 *  1. Плохой отзыв покупателя до выкупа → не выкупать.
 *  2. Старый висяк без ответа → сначала подтверждение (заморозка).
 */

import {
  GATE_FREEZE_CAP,
  STALE_BUYOUT_DAYS,
  decideGate,
  isStaleForBuyout,
  matchBadReview,
  runBuyoutGate,
  type GateOrder,
  type WbFeedback,
} from "../buyout-gate";

const NOW = Date.parse("2026-09-21T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000);

const order = (over: Partial<GateOrder> = {}): GateOrder => ({
  wbCode: "AAAAAAA",
  createdAt: daysAgo(1),
  nmId: 967431505,
  buyerName: "Юлия",
  ...over,
});

const feedback = (over: Partial<WbFeedback> = {}): WbFeedback => ({
  productValuation: 1,
  userName: "Юлия",
  productDetails: { nmId: 967431505 },
  createdDate: "2026-09-20T10:00:00Z",
  ...over,
});

describe("isStaleForBuyout", () => {
  it("свежий заказ не висяк, старше порога — висяк", () => {
    expect(isStaleForBuyout(daysAgo(STALE_BUYOUT_DAYS - 1), NOW)).toBe(false);
    expect(isStaleForBuyout(daysAgo(STALE_BUYOUT_DAYS + 1), NOW)).toBe(true);
  });
});

describe("matchBadReview", () => {
  it("ловит отзыв по имени + nmId + оценке ≤3", () => {
    const m = matchBadReview(order(), [feedback()]);
    expect(m?.productValuation).toBe(1);
  });

  it("имя нормализуется (регистр и пробелы)", () => {
    expect(matchBadReview(order({ buyerName: "  юлия " }), [feedback({ userName: "Юлия" })])).not.toBeNull();
  });

  it("другое имя — не наш отзыв", () => {
    expect(matchBadReview(order({ buyerName: "Денис" }), [feedback({ userName: "Юлия" })])).toBeNull();
  });

  it("другой товар — не наш отзыв", () => {
    expect(matchBadReview(order({ nmId: 111 }), [feedback({ productDetails: { nmId: 222 } })])).toBeNull();
  });

  it("хорошая оценка (4–5) не блокирует", () => {
    expect(matchBadReview(order(), [feedback({ productValuation: 5 })])).toBeNull();
  });

  it("чужой старый отзыв тёзки (до заказа −3д) не хоронит свежий заказ", () => {
    const o = order({ createdAt: daysAgo(1) });
    const old = feedback({ createdDate: "2026-07-01T00:00:00Z" });
    expect(matchBadReview(o, [old])).toBeNull();
  });

  it("без имени или без nmId сверять нечем — null (не-DBS заказ)", () => {
    expect(matchBadReview(order({ buyerName: null }), [feedback()])).toBeNull();
    expect(matchBadReview(order({ nmId: null }), [feedback()])).toBeNull();
  });

  it("nmId берётся и из productDetails, и из плоского nmId", () => {
    expect(matchBadReview(order(), [feedback({ productDetails: undefined, nmId: 967431505 })])).not.toBeNull();
  });
});

describe("decideGate", () => {
  it("плохой отзыв важнее висяка", () => {
    const d = decideGate(order({ createdAt: daysAgo(40) }), [feedback()], NOW);
    expect(d?.rule).toBe("bad_review");
  });

  it("старый висяк без отзыва → stale", () => {
    const d = decideGate(order({ createdAt: daysAgo(40), buyerName: "Никто" }), [feedback()], NOW);
    expect(d?.rule).toBe("stale");
    expect(d?.reason).toMatch(/подтвердите/i);
  });

  it("свежий чистый заказ — ничего", () => {
    expect(decideGate(order({ buyerName: "Никто" }), [feedback()], NOW)).toBeNull();
  });
});

describe("runBuyoutGate", () => {
  const setup = (orders: GateOrder[], feedbacks: WbFeedback[]) => {
    const frozen: Array<{ code: string; reason: string }> = [];
    return {
      frozen,
      deps: {
        loadBuyableOrders: async () => orders,
        loadNegativeFeedbacks: async () => feedbacks,
        freeze: async (code: string, reason: string) => { frozen.push({ code, reason }); },
        now: NOW,
      },
    };
  };

  it("морозит отзыв и висяк, чистые не трогает", async () => {
    const { frozen, deps } = setup([
      order({ wbCode: "BADREVW", createdAt: daysAgo(2) }),
      order({ wbCode: "STALE00", createdAt: daysAgo(40), buyerName: "Тихий" }),
      order({ wbCode: "CLEAN00", createdAt: daysAgo(2), buyerName: "Тихий" }),
    ], [feedback()]);
    const res = await runBuyoutGate(deps);
    expect(res.frozen.map((f) => f.wbCode).sort()).toEqual(["BADREVW", "STALE00"]);
    expect(frozen.map((f) => f.code).sort()).toEqual(["BADREVW", "STALE00"]);
  });

  it("выключенный гейт ничего не делает", async () => {
    const { frozen, deps } = setup([order({ createdAt: daysAgo(99) })], []);
    const res = await runBuyoutGate({ ...deps, enabled: false });
    expect(res.frozen).toHaveLength(0);
    expect(frozen).toHaveLength(0);
  });

  it("отзывы не тянутся, если проверять некого", async () => {
    let called = 0;
    await runBuyoutGate({
      loadBuyableOrders: async () => [],
      loadNegativeFeedbacks: async () => { called += 1; return []; },
      freeze: async () => {},
      now: NOW,
    });
    expect(called).toBe(0);
  });

  it("молчание feedbacks-api не роняет гейт (висяк всё равно ловится)", async () => {
    const { deps } = setup([order({ wbCode: "STALE00", createdAt: daysAgo(40), buyerName: "Т" })], []);
    const res = await runBuyoutGate({ ...deps, loadNegativeFeedbacks: async () => { throw new Error("WB 500"); } });
    expect(res.frozen.map((f) => f.rule)).toEqual(["stale"]);
  });

  it("больше лимита за прогон не морозит", async () => {
    const many = Array.from({ length: GATE_FREEZE_CAP + 5 }, (_, i) =>
      order({ wbCode: `S${i}`.padEnd(7, "0"), createdAt: daysAgo(40), buyerName: "Т" }));
    const { deps } = setup(many, []);
    const res = await runBuyoutGate(deps);
    expect(res.frozen).toHaveLength(GATE_FREEZE_CAP);
    expect(res.skippedByCap).toBe(5);
  });
});
