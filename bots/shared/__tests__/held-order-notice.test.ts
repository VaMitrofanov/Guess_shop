import { heldOrderBuyerText, isBadReviewHold, isOrderHeld } from "../held-order-notice";

describe("пасс на замороженном заказе (8L3JCD5)", () => {
  const gate = "плохой отзыв WB (покупатель, ★1, 2026-11-26) — выкуп запрещён до ручной проверки";

  it("узнаёт заморозку гейта по отзыву", () => {
    expect(isBadReviewHold(gate)).toBe(true);
    expect(isBadReviewHold("ручная заморозка")).toBe(false);
    expect(isOrderHeld({ heldAt: new Date() })).toBe(true);
    expect(isOrderHeld({ heldAt: null })).toBe(false);
  });

  it("говорит, что пасс принят и почему выкуп ждёт, без внутренней причины и без просьбы менять отзыв", () => {
    const text = heldOrderBuyerText(gate, "8L3JCD5");
    expect(text).toContain("Геймпасс получили");
    expect(text).toContain("отзыв");
    expect(text).toContain("8L3JCD5");
    expect(text).not.toContain("выкуп запрещён");
    expect(text).not.toMatch(/исправ|измен|удал/i);
    expect(text).not.toMatch(/[<>]/);
  });

  it("другая заморозка — нейтральный текст", () => {
    expect(heldOrderBuyerText("ручная заморозка", "X")).toContain("ручной проверке");
  });
});
