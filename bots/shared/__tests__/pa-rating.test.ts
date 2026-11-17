import { RATING_TEXT, ratingDue, ratingThanks } from "../pa-rating";

const now = 1_800_000_000;
const tail = (over: { outAgo?: number; inAgo?: number | null; text?: string; out?: boolean } = {}) => ({
  last: { out: over.out ?? true, date: now - (over.outAgo ?? 2 * 3600), text: over.text ?? "Проверили, всё в порядке", viaBot: false },
  lastIncoming: over.inAgo === null ? null : now - (over.inAgo ?? 3 * 3600),
});

describe("ratingDue — когда спросить оценку", () => {
  it("мы ответили 2 часа назад, покупатель писал до этого — спрашиваем", () => {
    expect(ratingDue(tail(), undefined, now)).toBe(true);
  });
  it("последним написал покупатель — не спрашиваем (ждёт ответа)", () => {
    expect(ratingDue(tail({ out: false }), undefined, now)).toBe(false);
  });
  it("меньше часа после нашего ответа — разговор может идти", () => {
    expect(ratingDue(tail({ outAgo: 20 * 60, inAgo: 30 * 60 }), undefined, now)).toBe(false);
  });
  it("больше суток — поздно", () => {
    expect(ratingDue(tail({ outAgo: 30 * 3600, inAgo: 31 * 3600 }), undefined, now)).toBe(false);
  });
  it("покупатель не писал — нечего оценивать (наша рассылка, закреп)", () => {
    expect(ratingDue(tail({ inAgo: null }), undefined, now)).toBe(false);
    expect(ratingDue(tail({ text: "📌 Ваш заказ" }), undefined, now)).toBe(false);
    expect(ratingDue(tail({ text: RATING_TEXT }), undefined, now)).toBe(false);
  });
  it("не чаще раза в 14 дней", () => {
    expect(ratingDue(tail(), new Date((now - 3 * 86_400) * 1000).toISOString(), now)).toBe(false);
    expect(ratingDue(tail(), new Date((now - 15 * 86_400) * 1000).toISOString(), now)).toBe(true);
  });
  it("тексты — от команды, без рода", () => {
    for (const t of [RATING_TEXT, ratingThanks("up"), ratingThanks("down")]) {
      expect(t).not.toMatch(/(ла|л)\s(вам|за)|поняла|передала|проверила/i);
    }
  });
});
