import { pushRecentSearch, RECENT_SEARCH_LIMIT } from "@/lib/recent-searches";

describe("недавние поиски", () => {
  it("новый запрос — в начало, повтор без учёта регистра поднимается, а не дублируется", () => {
    expect(pushRecentSearch(["AB12CD3", "lox23"], "ab12cd3")).toEqual(["ab12cd3", "lox23"]);
    expect(pushRecentSearch(["lox23"], "  XY99ZZ1 ")).toEqual(["XY99ZZ1", "lox23"]);
  });

  it("не больше лимита, и мусор не запоминается", () => {
    const many = Array.from({ length: 10 }, (_, i) => `q${i}`);
    expect(pushRecentSearch(many, "new")).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(pushRecentSearch(["a1"], "x")).toEqual(["a1"]);
    expect(pushRecentSearch(["a1"], "z".repeat(200))).toEqual(["a1"]);
  });
});
