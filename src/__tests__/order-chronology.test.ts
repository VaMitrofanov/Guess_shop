import { orderChronology, type FeedEntry } from "@/lib/order-feed";

const now = Date.parse("2026-11-16T12:00:00Z");

describe("хронология карточки: путь + лента одной лентой (16.11.2026)", () => {
  it("сливает и сортирует свежим сверху", () => {
    const feed: FeedEntry[] = [
      { key: "n0", text: "«долго висит»", meta: "Demid · 11 ноя", weight: "strong", ts: Date.parse("2026-11-11T10:00:00Z") },
    ];
    const out = orderChronology(feed, [
      { who: "buyer", text: "Ввёл код", at: "2026-08-17T09:22:00Z" },
      { who: "buyer", text: "Написал в поддержку", sub: "«уже месяц в очереди»", at: "2026-11-15T18:40:00Z" },
      { who: "us", text: "Отправили инструкцию", sub: "про цену", at: "2026-11-08T21:19:00Z" },
    ], now);
    expect(out.map((e) => e.text)).toEqual([
      "Написал в поддержку", "«долго висит»", "Отправили инструкцию · про цену", "Ввёл код",
    ]);
    expect(out[0].quote).toBe("уже месяц в очереди");
    expect(out[0].meta).toMatch(/^покупатель/);
  });

  it("одно событие, записанное в путь и в ленту, не дублируется", () => {
    const at = Date.parse("2026-11-10T10:00:00Z");
    const out = orderChronology(
      [{ key: "n0", text: "Вероятный ник: abc", weight: "dim", ts: at }],
      [{ who: "buyer", text: "Вероятный ник: abc", at: new Date(at + 20_000).toISOString() }],
      now,
    );
    expect(out).toHaveLength(1);
  });
});
