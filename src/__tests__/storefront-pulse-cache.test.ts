/**
 * Пульс главной не ждёт базу (16.11.2026): кэш «отдай старое, обнови в фоне».
 * Раньше раз в минуту посетитель ждал 7 запросов к Neon (0,8–1,8 с).
 */
let codeCount = 1;
const findMany = jest.fn(async () => []);
const aggregateCodes = jest.fn(async () => ({ _count: { _all: codeCount }, _sum: { denomination: codeCount * 1000 } }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    codeOrder: { findMany: (...a: unknown[]) => findMany(...(a as [])), aggregate: (...a: unknown[]) => aggregateCodes(...(a as [])) },
    wbOrder: { findMany: async () => [], aggregate: async () => ({ _count: { _all: 10 }, _sum: { amount: 5000 } }) },
    $queryRaw: async () => [{ gross: BigInt(7000) }],
    wbReview: { findMany: async () => [], count: async () => 0 },
  },
}));

import { storefrontPulse, storefrontPulseCached } from "@/lib/storefront-pulse";

it("холодный старт — ждём; дальше старое сразу, пересчёт в фоне", async () => {
  expect(storefrontPulseCached()).toBeNull();
  const first = await storefrontPulse();
  expect(first.totals.orders).toBe(11);

  codeCount = 2;
  const later = new Date(Date.now() + 120_000);
  const stale = await storefrontPulse(later);
  expect(stale.totals.orders).toBe(11); // отдали сразу, не дожидаясь базы
  await new Promise((r) => setTimeout(r, 10));
  expect((await storefrontPulse(later)).totals.orders).toBe(12); // фон досчитал
  expect(storefrontPulseCached(later)?.totals.orders).toBe(12);
});
