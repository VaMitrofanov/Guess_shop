import { giveawayPostText, giveawayResultText, joinGiveaway, pickWinner, type Giveaway } from "../giveaway";

const base: Giveaway = {
  id: "abc123", prize: 100, createdAt: "2026-11-15T09:00:00Z", endsAt: "2026-11-17T09:00:00Z",
  createdBy: "@admin", channelMessageId: 10, participants: [], status: "active",
};

describe("розыгрыш", () => {
  it("участник добавляется один раз, после итогов — нет", () => {
    const now = new Date("2026-11-16T09:00:00Z");
    const a = joinGiveaway(base, { tgId: "1", name: "Миша" }, now);
    expect(a.added).toBe(true);
    expect(joinGiveaway(a.giveaway, { tgId: "1", name: "Миша" }, now).added).toBe(false);
    expect(joinGiveaway(base, { tgId: "2", name: "Петя" }, new Date("2026-11-18T00:00:00Z")).added).toBe(false);
  });
  it("победитель — только из всё ещё подписанных", async () => {
    const g = { ...base, participants: [{ tgId: "1", name: "a", at: "" }, { tgId: "2", name: "b", at: "" }, { tgId: "3", name: "c", at: "" }] };
    for (let i = 0; i < 20; i += 1) {
      const w = await pickWinner(g, async (id) => id === "2");
      expect(w?.tgId).toBe("2");
    }
    expect(await pickWinner(g, async () => false)).toBeNull();
  });
  it("тексты: приз, срок, экранирование имени", () => {
    expect(giveawayPostText(base)).toContain("100 Robux");
    const done = giveawayResultText({ ...base, participants: [{ tgId: "1", name: "<b>x</b>", at: "" }], winner: { tgId: "1", name: "<b>x</b>", at: "" } });
    expect(done).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(done).toContain("1 участник");
  });
});
