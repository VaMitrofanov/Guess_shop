import { chatTurns, formatResponseStats, summarizeTurns } from "../pa-response-stats";

const MIN = 60;

describe("время ответа поддержки", () => {
  it("обращение = первая реплика после нашего ответа; ответ = первое наше после", () => {
    const turns = chatTurns([
      { date: 0, out: false },
      { date: 2 * MIN, out: false },
      { date: 10 * MIN, out: true },
      { date: 11 * MIN, out: true },
      { date: 20 * MIN, out: false },
      { date: 21 * MIN, out: true, viaBot: true },
      { date: 30 * MIN, out: false },
    ], 0, 3600);
    expect(turns).toEqual([
      { at: 0, delaySec: 10 * MIN, viaBot: false },
      { at: 20 * MIN, delaySec: MIN, viaBot: true },
      { at: 30 * MIN, delaySec: null, viaBot: false },
    ]);
  });

  it("обращения вне окна не считаются, даже если ответ в окне", () => {
    expect(chatTurns([{ date: -10, out: false }, { date: 5, out: true }], 0, 100)).toEqual([]);
  });

  it("сводка: человек, бот, без ответа, медиана", () => {
    const s = summarizeTurns([
      { delaySec: 5 * MIN, viaBot: false },
      { delaySec: 15 * MIN, viaBot: false },
      { delaySec: 2 * 3600, viaBot: false },
      { delaySec: 30, viaBot: true },
      { delaySec: null, viaBot: false },
    ]);
    expect(s).toMatchObject({ turns: 5, byHuman: 3, byBot: 1, unanswered: 1, medianMin: 15, p90Min: 120, overHour: 1 });
    expect(formatResponseStats(s, "за вчера")).toContain("медиана 15 мин");
    expect(formatResponseStats(s, "за вчера")).toContain("до 2 ч 0 мин");
  });
});
