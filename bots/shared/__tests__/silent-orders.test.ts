import { formatSilentSummary, mskWeekKey, silentWeeklyDue, summarizeSilent } from "../silent-orders";

const DAY = 86_400_000;
const now = Date.parse("2026-11-16T08:00:00Z"); // пн 11:00 МСК

describe("«Молчат»", () => {
  const orders = [
    { wbCode: "AAA1111", amount: 500, createdAt: new Date(now - 3 * DAY) },
    { wbCode: "BBB2222", amount: 1000, createdAt: new Date(now - 20 * DAY) },
    { wbCode: "CCC3333", amount: 800, createdAt: new Date(now - 45 * DAY) },
  ];
  it("корзины возраста и суммы", () => {
    const s = summarizeSilent(orders, now);
    expect(s).toMatchObject({ count: 3, robux: 2300, buckets: { under14: 1, d14to30: 1, over30: 1 }, robuxOver30: 800 });
    expect(s.oldest[0]).toEqual({ wbCode: "CCC3333", amount: 800, days: 45 });
  });
  it("текст без призывов отменять", () => {
    const t = formatSilentSummary(summarizeSilent(orders, now));
    expect(t).toContain("3 заказов");
    expect(t).not.toMatch(/отмен|замороз/i);
  });
  it("пусто — одна строка", () => {
    expect(formatSilentSummary(summarizeSilent([], now))).toContain("никого");
  });
  it("раз в неделю: пн после 10:00 МСК", () => {
    expect(mskWeekKey(now)).toBe("2026-11-16");
    expect(silentWeeklyDue(null, now)).toBe(true);
    expect(silentWeeklyDue("2026-11-16", now)).toBe(false);
    expect(silentWeeklyDue(null, Date.parse("2026-11-16T06:00:00Z"))).toBe(false); // 09:00 МСК
    expect(silentWeeklyDue(null, Date.parse("2026-11-17T08:00:00Z"))).toBe(false); // вторник
  });
});
