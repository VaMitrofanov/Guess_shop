import { compareNag, nagLevel, nagLine, worstTone } from "../buyer-nag";

describe("Ебут мозги / Спрашивают (28.11.2026)", () => {
  it("тон решает: ноет и резче — ебёт мозги; спокойный вопрос — спрашивает", () => {
    expect(nagLevel({ count: 1, tone: "nags" })).toBe("brain");
    expect(nagLevel({ count: 1, tone: "threat" })).toBe("brain");
    expect(nagLevel({ count: 2, tone: "asks" })).toBe("asks");
  });
  it("4 обращения за 48 ч — ебёт мозги даже вежливо", () => {
    expect(nagLevel({ count: 4, tone: "asks" })).toBe("brain");
  });
  it("порядок: тон › сколько раз › кто дольше ждёт", () => {
    const rows = [
      { id: "a", count: 9, tone: "nags", since: 100 },
      { id: "b", count: 2, tone: "aggressive", since: 200 },
      { id: "c", count: 9, tone: "nags", since: 50 },
      { id: "d", count: 12, tone: null, since: 10 },
    ];
    expect([...rows].sort(compareNag).map((r) => r.id)).toEqual(["b", "c", "a", "d"]);
  });
  it("самый резкий тон и строка", () => {
    expect(worstTone(["asks", "aggressive", "nags", null])).toBe("aggressive");
    expect(nagLine({ count: 8, tone: "aggressive" })).toBe("наезжает · 8 раз");
    expect(nagLine({ count: 3, tone: "asks" })).toBe("3 раза");
    expect(nagLine({ count: 1, tone: null })).toBe("1 раз");
  });
});
