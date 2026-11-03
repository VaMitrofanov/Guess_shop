import { formatOrderAge } from "@/lib/order-age";

describe("operator order age", () => {
  const createdAt = new Date("2026-07-11T10:00:00.000Z");

  test.each([
    ["2026-07-11T10:42:00.000Z", "🟢 42 мин"],
    ["2026-07-11T16:15:00.000Z", "🟢 6 ч 15 мин"],
    ["2026-07-12T14:00:00.000Z", "🟡 1 день 4 ч"],
    ["2026-07-14T14:00:00.000Z", "🟠 3 дня 4 ч"],
    ["2026-07-18T14:00:00.000Z", "🔴 7 дней 4 ч · недельный"],
    ["2026-07-25T10:00:00.000Z", "🔴 14 дней · старше 2 недель"],
  ])("formats %s as %s", (now, expected) => {
    expect(formatOrderAge(createdAt, new Date(now))).toBe(expected);
  });

  it("clamps future timestamps instead of showing a negative age", () => {
    expect(formatOrderAge(createdAt, new Date("2026-07-11T09:00:00.000Z"))).toBe("🟢 0 мин");
  });
});
