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
  isGateReviewHold,
  matchBadReview,
  matchFixedReview,
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

  it("заказ без пасса (staleCheck=false) ловится по отзыву, но не как висяк — W3QKRAA", () => {
    const fresh = decideGate(order({ staleCheck: false }), [feedback()], NOW);
    expect(fresh?.rule).toBe("bad_review");
    expect(fresh?.review?.productValuation).toBe(1);
    expect(decideGate(order({ staleCheck: false, createdAt: daysAgo(40), buyerName: "Никто" }), [feedback()], NOW)).toBeNull();
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
        loadFeedbacks: async () => ({ feedbacks, complete: true }),
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
      loadFeedbacks: async () => { called += 1; return { feedbacks: [], complete: true }; },
      freeze: async () => {},
      now: NOW,
    });
    expect(called).toBe(0);
  });

  it("молчание feedbacks-api не роняет гейт (висяк всё равно ловится)", async () => {
    const { deps } = setup([order({ wbCode: "STALE00", createdAt: daysAgo(40), buyerName: "Т" })], []);
    const res = await runBuyoutGate({ ...deps, loadFeedbacks: async () => { throw new Error("WB 500"); } });
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

/* 30.10.2026: правка отзыва у WB — новый отзыв, связанный со старым
   (`parentFeedbackId` / `childFeedbackId`). Решает последняя версия. */
describe("исправленный отзыв", () => {
  // W3QKRAA: ★1 в 08:53, переписан на ★5 в 13:53.
  const one = feedback({ id: "OLD", createdDate: "2026-09-20T10:00:00Z", childFeedbackId: "NEW" });
  const five = feedback({ id: "NEW", productValuation: 5, createdDate: "2026-09-20T15:00:00Z", parentFeedbackId: "OLD" });

  it("★1, переписанная на ★5, плохой больше не считается", () => {
    expect(matchBadReview(order(), [one, five])).toBeNull();
    expect(matchFixedReview(order(), [one, five])).toEqual({ review: five, was: one });
  });

  it("★5, переписанная на ★1, — плохой (обратная правка)", () => {
    const good = feedback({ id: "A", productValuation: 5, childFeedbackId: "B" });
    const bad = feedback({ id: "B", productValuation: 1, parentFeedbackId: "A" });
    expect(matchBadReview(order(), [good, bad])?.id).toBe("B");
    expect(matchFixedReview(order(), [good, bad])).toBeNull();
  });

  it("новая версия не пришла в выдаче — доверяем той, что видим (не размораживаем вслепую)", () => {
    expect(matchBadReview(order(), [one])?.id).toBe("OLD");
    expect(matchFixedReview(order(), [one])).toBeNull();
  });

  it("тёзка с ★5 не размораживает того, кто стоит на ★1", () => {
    const other = feedback({ id: "X", productValuation: 1 });
    expect(matchFixedReview(order(), [one, five, other])).toBeNull();
  });

  it("просто ★5 без плохой истории — не «исправление»", () => {
    expect(matchFixedReview(order(), [feedback({ id: "G", productValuation: 5 })])).toBeNull();
  });

  it("свой замок гейт узнаёт, перебитый заявкой или человеком — нет", () => {
    const d = decideGate(order(), [feedback()], NOW)!;
    expect(isGateReviewHold({ reason: d.reason, createdBy: "гейт выкупа" })).toBe(true);
    expect(isGateReviewHold({ reason: d.reason, createdBy: "автозащита" })).toBe(false);
    expect(isGateReviewHold({ reason: "заказ висит 30 дн.", createdBy: "гейт выкупа" })).toBe(false);
  });

  const run = (holds: GateOrder[], feedbacks: WbFeedback[], complete = true) => {
    const released: string[] = [];
    return runBuyoutGate({
      loadBuyableOrders: async () => [],
      loadReviewHolds: async () => holds,
      loadFeedbacks: async () => ({ feedbacks, complete }),
      freeze: async () => {},
      release: async (code) => { released.push(code); },
      now: NOW,
    }).then((res) => ({ res, released }));
  };

  it("свип снимает замок, когда отзыв исправлен", async () => {
    const { res, released } = await run([order({ wbCode: "W3QKRAA" })], [one, five]);
    expect(released).toEqual(["W3QKRAA"]);
    expect(res.released[0]).toMatchObject({ wbCode: "W3QKRAA", was: { productValuation: 1 }, review: { productValuation: 5 } });
  });

  it("неполная выдача WB — не размораживаем (потерянной могла быть свежая ★1)", async () => {
    const { released } = await run([order({ wbCode: "W3QKRAA" })], [one, five], false);
    expect(released).toEqual([]);
  });
});

