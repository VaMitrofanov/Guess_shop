/** «Застрял на геймпассе» — только на третьей попытке (17.11.2026). */
import { GAMEPASS_STUCK_AFTER, clearGamepassFails, gamepassStuckText, noteGamepassFail, resetGamepassFails } from "../gamepass-stuck-notice";

const fail = (detail = "цена 1000 вместо 1429") => ({ reason: "pass_price" as const, detail, passId: "1907029789" });

describe("gamepass-stuck-notice", () => {
  beforeEach(() => resetGamepassFails());

  it("зовёт ровно на третьей попытке за сутки", () => {
    const t = Date.UTC(2026, 10, 17, 9);
    expect(GAMEPASS_STUCK_AFTER).toBe(3);
    expect(noteGamepassFail("k", fail(), t)).toBeNull();
    expect(noteGamepassFail("k", fail(), t + 1)).toBeNull();
    expect(noteGamepassFail("k", fail(), t + 2)).toHaveLength(3);
    expect(noteGamepassFail("k", fail(), t + 3)).toBeNull();
  });

  it("попытки старше суток и удачная проверка — не в счёт", () => {
    const t = Date.UTC(2026, 10, 17, 9);
    noteGamepassFail("k", fail(), t);
    noteGamepassFail("k", fail(), t + 1);
    expect(noteGamepassFail("k", fail(), t + 25 * 3_600_000)).toBeNull();
    clearGamepassFails("k");
    noteGamepassFail("k", fail(), t + 26 * 3_600_000);
    expect(noteGamepassFail("k", fail(), t + 26 * 3_600_000 + 1)).toBeNull();
  });

  it("общий язык уведов, причины без повторов", () => {
    const at = 0;
    const text = gamepassStuckText({
      via: "tg-bot", wbCode: "HZ8AJ72", denomination: 1000, buyerHtml: "@user",
      attempts: [{ ...fail("не в продаже"), at }, { ...fail(), at }, { ...fail(), at }],
    });
    expect(text.replace(/\u00a0/g, " ")).toBe([
      "🟡 <b>ПОДДЕРЖКА · застрял на геймпассе</b>",
      "<code>HZ8AJ72</code> · <b>1 000 R$</b> · @user · TG",
      "🎫 <code>1907029789</code> · 3 попытки: не в продаже; цена 1000 вместо 1429",
    ].join("\n"));
  });
});
