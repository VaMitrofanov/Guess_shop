import { applyKeyOutcome, summarizeKeyOutcomes } from "../key-outcomes";

describe("учёт исходов ключа", () => {
  const now = new Date("2026-11-15T09:00:00Z");
  it("копит по дням и причинам, свежие сверху, ключа в записи нет", () => {
    let s = applyKeyOutcome(null, { via: "tg-bot", result: "ok", nick: "a" }, now);
    s = applyKeyOutcome(s, { via: "site", result: "bad_scope", nick: "b" }, now);
    s = applyKeyOutcome(s, { via: "vk-bot", result: "bad_scope", nick: "c" }, now);
    expect(s.days["2026-11-15"]).toEqual({ ok: 1, bad_scope: 2 });
    expect(s.recent[0]).toMatchObject({ via: "vk-bot", result: "bad_scope", nick: "c" });
    const sum = summarizeKeyOutcomes(s, 7, now);
    expect(sum).toEqual({ total: 3, ok: 1, failures: [["bad_scope", 2]] });
  });
  it("за пределами окна не считает", () => {
    const old = applyKeyOutcome(null, { via: "site", result: "no_universe" }, new Date("2026-10-01T09:00:00Z"));
    expect(summarizeKeyOutcomes(old, 7, now).total).toBe(0);
  });
});
