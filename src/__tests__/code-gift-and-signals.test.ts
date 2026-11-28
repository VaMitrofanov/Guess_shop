jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { withGift } from "@/lib/codes/referral";
import { groupSignals, nextStep } from "@/app/twa/_components/SignalsBoard";
import type { RiskFeedItem } from "@/lib/risk-feed-types";

/* 🎁 Подарочная скидка (19.11.2026): берётся бо́льшая, не складывается. */
describe("withGift", () => {
  const gift = { id: "g1", percent: 5, note: null };
  it("подарок щедрее обычной скидки — он и даёт цену", () => {
    expect(withGift(0, gift)).toEqual({ percent: 5, giftApplied: true });
    expect(withGift(1, gift)).toEqual({ percent: 5, giftApplied: true });
  });
  it("обычная скидка не меньше — подарок ждёт, не тратится", () => {
    expect(withGift(5, gift)).toEqual({ percent: 5, giftApplied: false });
    expect(withGift(2, null)).toEqual({ percent: 2, giftApplied: false });
  });
});

/* ⚠ «Разобрать» в «Заказах»: события → карточка на заказ. */
describe("groupSignals", () => {
  const ev = (over: Partial<RiskFeedItem>): RiskFeedItem => ({
    id: Math.random().toString(36), kind: "BAD_REVIEW", wbCode: "AAAAAAA", wbOrderId: "1", buyerName: "Юлия", buyerKey: "юлия",
    amount: 800, stars: 1, starsBefore: null, text: "не пришли", action: null,
    occurredAt: "2026-11-10T10:00:00Z", resolvedAt: null, resolvedBy: null,
    order: { id: "o1", status: "PENDING", held: false }, ...over,
  });
  it("события одного заказа — одна карточка; без кода — каждое своё", () => {
    const g = groupSignals([ev({}), ev({ kind: "CLAIM_OPENED", occurredAt: "2026-11-12T10:00:00Z" }), ev({ wbCode: null, order: null }), ev({ wbCode: null, order: null })]);
    expect(g).toHaveLength(3);
    expect(g[0].items).toHaveLength(2);
  });
  it("вкладки по тому, чей ход", () => {
    expect(groupSignals([ev({ order: { id: "o", status: "PENDING", held: true } })])[0].lane).toBe("now");
    expect(groupSignals([ev({ kind: "BUYER_CANCEL" })])[0].lane).toBe("now");
    expect(groupSignals([ev({ order: { id: "o", status: "AWAITING_GAMEPASS", held: false } })])[0].lane).toBe("buyer");
    expect(groupSignals([ev({ order: null })])[0].lane).toBe("buyer");
    expect(groupSignals([ev({ kind: "BUYER_QUESTION" })])[0].lane).toBe("watch");
  });
  it("подсказка — по самому острому сигналу", () => {
    expect(nextStep(groupSignals([ev({}), ev({ kind: "CLAIM_OPENED" })])[0])).toMatch(/возврат/i);
    expect(nextStep(groupSignals([ev({ order: { id: "o", status: "AWAITING_GAMEPASS", held: false } })])[0])).toMatch(/геймпасс/i);
  });
});
