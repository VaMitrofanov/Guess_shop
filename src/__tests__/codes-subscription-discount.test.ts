jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { discountWithSubscription } from "@/lib/codes/referral";
import { isNewYearSeason } from "@/lib/new-year";

describe("скидка 1 % = регистрация + подписка", () => {
  it("без подписки базового процента нет, уровни за друзей остаются", () => {
    expect(discountWithSubscription(0, false)).toBe(0);
    expect(discountWithSubscription(0, true)).toBe(1);
    expect(discountWithSubscription(2, false)).toBe(0);
    expect(discountWithSubscription(3, false)).toBe(2);
    expect(discountWithSubscription(30, false)).toBe(5);
  });
});

describe("новогодний сезон", () => {
  it("с 1 декабря по 14 января по Москве", () => {
    expect(isNewYearSeason(new Date("2026-11-30T20:59:00Z"))).toBe(false);
    expect(isNewYearSeason(new Date("2026-11-30T21:00:00Z"))).toBe(true);
    expect(isNewYearSeason(new Date("2027-01-14T20:00:00Z"))).toBe(true);
    expect(isNewYearSeason(new Date("2027-01-14T21:00:00Z"))).toBe(false);
  });
});
