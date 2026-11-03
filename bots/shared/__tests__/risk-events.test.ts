/**
 * Лента «Риски» (30.10.2026): какие события рождаются и какие сразу разобраны.
 */
import {
  badReviewEvent,
  buyerKeyOf,
  claimEvents,
  reviewBelongsInFeed,
  reviewFixedEvent,
  reviewText,
  type RiskOrder,
} from "../risk-events";

const NOW = new Date("2026-10-30T12:00:00Z");
const order = (over: Partial<RiskOrder> = {}): RiskOrder => ({
  marketplaceId: "mp1",
  wbCode: "W3QKRAA",
  wbOrderId: "6154830545",
  buyerName: "  Дазайчik ",
  nmId: 939574441,
  amount: 1000,
  createdAt: new Date("2026-10-29T16:09:00Z"),
  closed: false,
  claimOpenedAt: null,
  claimReason: null,
  claimResolvedAt: null,
  refunded: false,
  ...over,
});
const one = { id: "OLD", productValuation: 1, text: "игнорят", createdDate: "2026-10-30T05:53:58Z", childFeedbackId: "NEW" };
const five = { id: "NEW", productValuation: 5, text: "всё отлично", createdDate: "2026-10-30T10:53:12Z", parentFeedbackId: "OLD" };

describe("risk-events", () => {
  it("ключ досье — имя без регистра и пробелов", () => {
    expect(buyerKeyOf("  Дазайчik ")).toBe("дазайчik");
    expect(buyerKeyOf("А")).toBeNull();
  });

  it("плохой отзыв по живому заказу открыт, по закрытому — сразу разобран", () => {
    const open = badReviewEvent(order(), one, "frozen", NOW);
    expect(open).toMatchObject({ kind: "BAD_REVIEW", stars: 1, action: "frozen", buyerKey: "дазайчik", dedupeKey: "bad:mp1:OLD" });
    expect(open.resolvedAt).toBeUndefined();
    const closed = badReviewEvent(order({ closed: true }), one, "none", NOW);
    expect(closed.resolvedAt).toEqual(NOW);
  });

  it("исправление разобрано сразу и помнит «было»", () => {
    const e = reviewFixedEvent(order(), { review: five, was: one }, "released", NOW);
    expect(e).toMatchObject({ kind: "REVIEW_FIXED", stars: 5, starsBefore: 1, action: "released", resolvedAt: NOW });
  });

  it("заявка: открытие и решение — два события; решение разобрано сразу", () => {
    const evs = claimEvents(order({
      claimOpenedAt: new Date("2026-10-30T06:00:00Z"),
      claimReason: "не смог создать",
      claimResolvedAt: new Date("2026-10-30T06:31:00Z"),
      refunded: true,
    }), NOW);
    expect(evs.map((e) => e.kind)).toEqual(["CLAIM_OPENED", "CLAIM_RESOLVED"]);
    expect(evs[1].text).toMatch(/в пользу покупателя/);
    expect(evs[1].resolvedAt).toEqual(NOW);
  });

  it("отзыв тёзки через два месяца после заказа — не в ленту", () => {
    expect(reviewBelongsInFeed(order(), one)).toBe(true);
    expect(reviewBelongsInFeed(order({ createdAt: new Date("2026-08-01T00:00:00Z") }), one)).toBe(false);
  });

  it("текст отзыва склеивает достоинства и недостатки", () => {
    expect(reviewText({ text: "", pros: "быстро", cons: "дорого" })).toBe("+ быстро\n− дорого");
    expect(reviewText({})).toBeNull();
  });
});
