/**
 * Гейт выкупа: два правила владельца (21.09.2026).
 *  1. Плохой отзыв покупателя до выкупа → не выкупать.
 *  2. Старый висяк без ответа → сначала подтверждение (заморозка).
 */

import {
  GATE_FREEZE_CAP,
  attributeFeedbacks,
  foreignReviewOfHold,
  NOT_FOREIGN_REVIEW,
  MISATTRIBUTED_ACTOR,
  STALE_BUYOUT_DAYS,
  decideGate,
  isStaleForBuyout,
  isGateReviewHold,
  matchBadReview,
  matchDeletedReview,
  matchFixedReview,
  runBuyoutGate,
  type DeletedReview,
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


/* 12.11.2026: плохой отзыв удалён (WB отвечает 404 на запрос по номеру).
   Замок гейта снимается, если других плохих отзывов у покупателя нет. */
describe("удалённый отзыв", () => {
  const gone: DeletedReview = { feedbackId: "DEL", stars: 1, text: "робуксы не пришли", reviewedAt: daysAgo(2) };
  const deleted = (code = "AAAAAAA") => new Map([[code, gone]]);

  const run = (holds: GateOrder[], feedbacks: WbFeedback[], map: Map<string, DeletedReview>, complete = true) => {
    const released: string[] = [];
    return runBuyoutGate({
      loadBuyableOrders: async () => [],
      loadReviewHolds: async () => holds,
      loadFeedbacks: async () => ({ feedbacks, complete }),
      freeze: async () => {},
      release: async (code) => { released.push(code); },
      deletedReviews: map,
      now: NOW,
    }).then((res) => ({ res, released }));
  };

  it("отзыв удалён, других плохих нет — удалённый найден", () => {
    expect(matchDeletedReview(order(), [], deleted())).toEqual(gone);
  });

  it("второй плохой отзыв того же покупателя держит замок", () => {
    expect(matchDeletedReview(order(), [feedback({ id: "STILL" })], deleted())).toBeNull();
  });

  it("чужой заказ не трогаем", () => {
    expect(matchDeletedReview(order({ wbCode: "BBBBBBB" }), [], deleted())).toBeNull();
  });

  it("свип снимает свой замок и сообщает об удалении", async () => {
    const { res, released } = await run([order()], [], deleted());
    expect(released).toEqual(["AAAAAAA"]);
    expect(res.releasedDeleted).toEqual([{ wbCode: "AAAAAAA", deleted: gone }]);
    expect(res.released).toEqual([]);
  });

  it("неполная выдача — не снимаем", async () => {
    const { released } = await run([order()], [], deleted(), false);
    expect(released).toEqual([]);
  });

  it("исправление важнее удаления: одна разморозка, как исправленный", async () => {
    const one = feedback({ id: "OLD", childFeedbackId: "NEW" });
    const five = feedback({ id: "NEW", productValuation: 5, parentFeedbackId: "OLD" });
    const { res, released } = await run([order()], [one, five], deleted());
    expect(released).toEqual(["AAAAAAA"]);
    expect(res.released).toHaveLength(1);
    expect(res.releasedDeleted).toEqual([]);
  });
});

/* 19.11.2026: чей отзыв — по времени заказа WB, а не по имени. Данные — живой
   случай: ★1 «Кристины» (заказ WB 08.11 08:17:49) заморозила и 8ZJ6BRX
   другой Кристины (заказ 07.11). */
describe("attributeFeedbacks — отзыв к заказу по времени заказа WB", () => {
  const NM = 967447850;
  const cand = (code: string | null, at: string, buyerName: string | null = null, nmId = NM) =>
    ({ code, nmId, at: new Date(at), buyerName });
  const kristinaOrders = [
    cand("8ZJ6BRX", "2026-11-07T06:50:47Z", "Кристина"),
    cand("WJ3VUEY", "2026-11-08T08:03:44Z", "Ксения"),
    cand("K9XZ5UL", "2026-11-08T08:17:51Z", "Кристина"),
  ];
  const review = (over: Partial<WbFeedback> = {}) => feedback({
    id: "FY", userName: "Кристина", productDetails: { nmId: NM },
    createdDate: "2026-11-08T11:58:01Z", lastOrderCreatedAt: "2026-11-08T08:17:49Z", ...over,
  });
  const gate = (wbCode: string, createdAt = "2026-11-07T06:56:46Z") =>
    order({ wbCode, nmId: NM, buyerName: "Кристина", createdAt: new Date(createdAt) });

  it("тёзка с другим заказом отзыв не получает — только автор", () => {
    const f = review();
    attributeFeedbacks([f], kristinaOrders);
    expect(f.orderCodes).toEqual(["K9XZ5UL"]);
    expect(matchBadReview(gate("8ZJ6BRX"), [f])).toBeNull();
    expect(matchBadReview(gate("K9XZ5UL", "2026-11-08T08:53:55Z"), [f])?.id).toBe("FY");
  });

  it("имя в отзыве и в чате разное — заказ всё равно находится", () => {
    const f = review({ userName: "аринка" });
    attributeFeedbacks([f], [cand("V7BSW9Y", "2026-11-08T08:17:50Z", "rina")]);
    expect(matchBadReview(order({ wbCode: "V7BSW9Y", nmId: NM, buyerName: "rina", createdAt: new Date("2026-11-08T08:20:00Z") }), [f])).not.toBeNull();
  });

  it("заказ без имени в чате тоже получает свой отзыв", () => {
    const f = review();
    attributeFeedbacks([f], [cand("NONAME1", "2026-11-08T08:17:52Z")]);
    expect(matchBadReview(order({ wbCode: "NONAME1", nmId: NM, buyerName: null, createdAt: new Date("2026-11-08T08:20:00Z") }), [f])).not.toBeNull();
    expect(decideGate(order({ wbCode: "NONAME1", nmId: NM, buyerName: null }), [f], NOW)?.reason).toContain("Кристина");
  });

  it("задание DBS приходит до 10 минут позже заказа — берём ближайшее", () => {
    const f = review({ lastOrderCreatedAt: "2026-11-15T11:56:14Z", userName: "Людмила" });
    attributeFeedbacks([f], [cand("LUDA001", "2026-11-15T11:56:45Z", "Людмила"), cand("VERA001", "2026-11-15T11:58:03Z", "Вероника")]);
    expect(f.orderCodes).toEqual(["LUDA001"]);
    const late = review({ lastOrderCreatedAt: "2026-10-11T08:08:08Z" });
    attributeFeedbacks([late], [cand("TKQMJHF", "2026-10-11T08:15:45Z", "Вероника")]);
    expect(late.orderCodes).toEqual(["TKQMJHF"]);
  });

  it("вне окна, другой товар или задание раньше заказа — ничей", () => {
    const f = review();
    attributeFeedbacks([f], [
      cand("FAR0001", "2026-11-08T08:40:00Z"),
      cand("NM00001", "2026-11-08T08:17:50Z", null, 111),
      cand("EARLY01", "2026-11-08T08:10:00Z"),
    ]);
    expect(f.orderCodes).toEqual([]);
    expect(matchBadReview(gate("FAR0001"), [f])).toBeNull();
  });

  it("одна корзина (та же секунда) — отзыв на все её заказы; разные имена — совпавшее", () => {
    const cart = review({ userName: "Павел" });
    attributeFeedbacks([cart], [cand("KU6VMV5", "2026-11-08T08:17:55Z", "Павел"), cand("8GPBVEY", "2026-11-08T08:17:55Z", "Павел")]);
    expect(cart.orderCodes?.sort()).toEqual(["8GPBVEY", "KU6VMV5"]);
    const two = review({ userName: "Ирина" });
    attributeFeedbacks([two], [cand("IRINA01", "2026-11-08T08:17:51Z", "Ирина"), cand("OLGA001", "2026-11-08T08:17:52Z", "Ольга")]);
    expect(two.orderCodes).toEqual(["IRINA01"]);
  });

  it("без времени заказа — прежняя сверка по имени; правленая версия наследует привязку", () => {
    const legacy = review({ lastOrderCreatedAt: null, createdDate: "2026-11-07T10:00:00Z" });
    attributeFeedbacks([legacy], kristinaOrders);
    expect(legacy.orderCodes).toBeUndefined();
    expect(matchBadReview(gate("8ZJ6BRX"), [legacy])).not.toBeNull();

    const one = review({ id: "OLD", childFeedbackId: "NEW" });
    const five = review({ id: "NEW", parentFeedbackId: "OLD", productValuation: 5, lastOrderCreatedAt: null });
    attributeFeedbacks([one, five], kristinaOrders);
    expect(five.orderCodes).toEqual(["K9XZ5UL"]);
    expect(matchFixedReview(gate("K9XZ5UL"), [one, five])?.review.id).toBe("NEW");
    expect(matchFixedReview(gate("8ZJ6BRX"), [one, five])).toBeNull();
  });
});

describe("foreignReviewOfHold — замок гейта за чужой отзыв (WSS8CAC, 19.11.2026)", () => {
  const NM = 939574441;
  const anna = (over: Partial<WbFeedback> = {}) => feedback({
    id: "ANNA", userName: "Анна", productValuation: 1, productDetails: { nmId: NM },
    createdDate: "2026-11-10T09:00:00Z", lastOrderCreatedAt: "2026-11-10T08:00:00Z", ...over,
  });
  const wss = order({ wbCode: "WSS8CAC", nmId: NM, buyerName: "Анна", createdAt: new Date("2026-08-19T12:43:29Z") });
  const reason = "плохой отзыв WB (Анна, ★1, 2026-11-10) — выкуп запрещён до ручной проверки";

  it("отзыв из причины по времени — другого заказа → чужой", () => {
    const f = anna();
    attributeFeedbacks([f], [{ code: "OTHER01", nmId: NM, at: new Date("2026-11-10T08:03:00Z"), buyerName: "Анна" }]);
    expect(foreignReviewOfHold(wss, reason, [f])?.id).toBe("ANNA");
  });

  it("отзыв по времени этого заказа — замок остаётся", () => {
    const f = anna({ lastOrderCreatedAt: "2026-08-19T12:43:27Z" });
    attributeFeedbacks([f], [{ code: "WSS8CAC", nmId: NM, at: new Date("2026-08-19T12:43:29Z"), buyerName: "Анна" }]);
    expect(foreignReviewOfHold(wss, reason, [f])).toBeNull();
  });

  it("без привязки по времени (нет lastOrderCreatedAt) — не трогаем", () => {
    expect(foreignReviewOfHold(wss, reason, [anna({ lastOrderCreatedAt: null })])).toBeNull();
  });

  it("две версии правленого отзыва с одной привязкой — это один отзыв (живой WSS8CAC)", () => {
    const a = anna({ id: "A1", childFeedbackId: "A2", lastOrderCreatedAt: "2026-10-19T14:44:30Z" });
    const b = anna({ id: "A2", parentFeedbackId: "A1", lastOrderCreatedAt: "2026-10-19T14:44:30Z" });
    attributeFeedbacks([a, b], []);
    expect(a.orderCodes).toEqual([]);
    expect(foreignReviewOfHold(wss, reason, [a, b])?.id).toBe("A1");
  });

  it("два разных отзыва с разной привязкой — не угадываем", () => {
    const a = anna({ id: "A1", lastOrderCreatedAt: "2026-11-10T08:00:00Z" });
    const b = anna({ id: "A2", lastOrderCreatedAt: "2026-08-19T12:43:27Z" });
    attributeFeedbacks([a, b], [
      { code: "OTHER01", nmId: NM, at: new Date("2026-11-10T08:03:00Z"), buyerName: "Анна" },
      { code: "OTHER02", nmId: NM, at: new Date("2026-08-19T12:43:29Z"), buyerName: "Анна" },
    ]);
    expect(foreignReviewOfHold(wss, reason, [a, b])).toBeNull();
  });

  it("ручной замок и замок «висяк» не трогаем", () => {
    const f = anna();
    attributeFeedbacks([f], [{ code: "OTHER01", nmId: NM, at: new Date("2026-11-10T08:03:00Z"), buyerName: "Анна" }]);
    expect(foreignReviewOfHold(wss, "отзыв", [f])).toBeNull();
  });

  it("NOT_FOREIGN_REVIEW оставляет неразобранные (resolvedBy = NULL)", () => {
    expect(NOT_FOREIGN_REVIEW.OR).toEqual([{ resolvedBy: null }, { resolvedBy: { not: MISATTRIBUTED_ACTOR } }]);
  });
});
