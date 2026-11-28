/**
 * Лента заказа и «Сейчас» (11.11.2026): одна хроника из заметки и пометок,
 * один блок состояния, строка под ником и слово состояния в очереди.
 */
import { feedWhen, orderFeed, orderHeadline, orderNote, orderNow, orderStateWord } from "@/lib/order-feed";
import { humanNoteLine } from "../../bots/shared/order-hold";

const NOW = Date.parse("2026-11-11T09:00:00Z"); // 12:00 МСК
const note = [
  "[ЗАМЕТКА 11.11, 10:42 · Demid] Выкупаем 500, вторую карту активирует сама",
  "[РАЗМОРОЗКА 10.11, 23:30 · Roblox] заморожена снята вручную — автоматика не морозит",
  "[ЗАМОРОЗКА 05.11, 18:34 · автозащита] Возврат на WB",
  "[EDIT 2026-11-05 от GuessWho] ГП 1948448577→2072228499",
  "старая заметка без метки",
].join("\n");
const claim = { kind: "CLAIM", at: "2026-11-05T07:25:00Z", detail: "начислено 500 вместо 1000" };

describe("orderFeed", () => {
  it("заметка + пометки одной хроникой, свежее сверху, у правки автор", () => {
    const feed = orderFeed({ adminNote: note, flags: [{ ...claim, ackAt: "2026-11-11T07:40:00Z", ackBy: "Demid" }] }, NOW);
    expect(feed[0].text).toBe("Выкупаем 500, вторую карту активирует сама");
    expect(feed[0].meta).toBe("Demid · 10:42");
    expect(feed.map(e => e.text)).toContain("Возврат открыт — договорились");
    expect(feed.find(e => e.text === "Открыт возврат на WB")?.quote).toBe("начислено 500 вместо 1000");
    expect(feed.find(e => e.text.startsWith("Разморожен"))?.text).toBe("Разморожен вручную");
    expect(feed.find(e => e.text.startsWith("Правка"))?.meta).toContain("GuessWho");
  });
});

describe("orderNow", () => {
  it("заморозка важнее всего и предлагает разморозить", () => {
    const n = orderNow({ heldAt: "x", heldReason: "плохой отзыв", flags: [claim] }, NOW)!;
    expect(n.title).toBe("Заморожен — не выкупать");
    expect(n.action).toEqual({ kind: "unhold" });
  });
  it("нерешённая пометка — решить; погашенная — можно выкупать", () => {
    expect(orderNow({ flags: [claim] }, NOW)!.action).toEqual({ kind: "ack", flag: "CLAIM" });
    const ok = orderNow({ adminNote: note, flags: [{ ...claim, ackAt: "2026-11-11T07:40:00Z", ackBy: "Demid" }] }, NOW)!;
    expect(ok.title).toBe("Можно выкупать");
    expect(ok.note?.text).toBe("Выкупаем 500, вторую карту активирует сама");
  });
  it("ничего нет — блока нет", () => {
    expect(orderNow({}, NOW)).toBeNull();
  });
});

describe("строка очереди", () => {
  it("под ником — заметка, иначе слова покупателя", () => {
    expect(orderHeadline({ adminNote: note }, NOW)).toBe("Выкупаем 500, вторую карту активирует сама");
    expect(orderHeadline({ flags: [claim] }, NOW)).toBe("«начислено 500 вместо 1000»");
    expect(orderNote({ adminNote: "просто текст" }, NOW)?.text).toBe("просто текст");
  });
  it("слово состояния", () => {
    expect(orderStateWord({ heldAt: "x" })?.text).toBe("заморожен");
    expect(orderStateWord({ flags: [claim] })?.text).toBe("возврат открыт");
    expect(orderStateWord({ flags: [{ ...claim, ackAt: "x" }] })?.text).toBe("договорились");
    expect(orderStateWord({})).toBeNull();
  });
  it("время коротко: часы, вчера, дата", () => {
    expect(feedWhen(NOW - 3600_000, NOW)).toBe("11:00");
    expect(feedWhen(NOW - 20 * 3600_000, NOW)).toBe("вчера");
    expect(feedWhen(Date.parse("2026-11-05T07:25:00Z"), NOW)).toMatch(/^5 ноя/);
  });
  it("строка заметки человека с меткой и автором", () => {
    expect(humanNoteLine("  договорились  в чате ", "Demid")).toMatch(/^\[ЗАМЕТКА \d{2}\.\d{2}, \d{2}:\d{2} · Demid\] договорились в чате$/);
  });
});

describe("collapseFeed — повторы ленты одной строкой", () => {
  const { collapseFeed } = jest.requireActual("@/lib/order-feed") as typeof import("@/lib/order-feed");
  const e = (key: string, text: string, meta: string, ts: number) => ({ key, text, meta, weight: "dim" as const, ts });

  it("заморозки/разморозки подряд — одна строка с причиной и кто менял", () => {
    const out = collapseFeed([
      e("1", "Разморожен", "Roblox · вчера", 9),
      e("2", "Заморожен: Возврат на WB: «купила 2 карточку»", "автозащита · 5 ноя", 8),
      e("3", "Разморожен", "GuessWho · 5 ноя", 7),
      e("4", "Заморожен: Возврат на WB: «купила 2 карточку»", "автозащита · 5 ноя", 6),
      e("5", "Правка: ГП 1→2", "GuessWho · 5 ноя", 5),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe("❄️ Заморожен ↔ разморожен ×4");
    expect(out[0].quote).toBe("Возврат на WB: «купила 2 карточку»");
    expect(out[0].meta).toBe("Roblox, автозащита, GuessWho · вчера");
    expect(out[1].text).toBe("Правка: ГП 1→2");
  });

  it("одиночные события не трогает, одинаковые подряд — ×N", () => {
    const out = collapseFeed([e("a", "Висит без выкупа", "1 ноя", 3), e("b", "Висит без выкупа", "31 окт", 2), e("c", "Разморожен", "x · 30 окт", 1)]);
    expect(out.map((x) => x.text)).toEqual(["Висит без выкупа ×2", "Разморожен"]);
  });
});
