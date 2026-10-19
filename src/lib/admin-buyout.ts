import "server-only";

import { prisma } from "@/lib/prisma";
import { TAB_SQL, type GamepassExportTab, loadGamepassExport } from "@/lib/order-queue";
import { logAdminTiming } from "@/lib/admin-performance";

type BuyoutCountRow = {
  BUYOUT: bigint;
  DIRECT: bigint;
  AVITO: bigint;
  WORK: bigint;
  ERROR: bigint;
  ATTENTION: bigint;
};

async function loadBuyoutCounts() {
  /* Те же правила, что у ленты (`TAB_SQL`). Своя копия до 20.10 не знала о
     заморозке: «К выкупу 41» здесь против «Выкупить 25» в рабочем месте. */
  const tabs = ["BUYOUT", "DIRECT", "AVITO", "WORK", "ERROR", "ATTENTION"] as const;
  const rows = await prisma.$queryRawUnsafe<BuyoutCountRow[]>(`
    SELECT ${tabs.map(tab => `COUNT(*) FILTER (WHERE ${TAB_SQL[tab]}) AS "${tab}"`).join(", ")}
    FROM "WbOrder"
    WHERE "isTest" = false
  `);
  const row = rows[0];
  return row
    ? Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]))
    : {};
}

export async function loadAdminBuyoutData(tab: GamepassExportTab) {
  const startedAt = performance.now();
  const [gamepassExport, batches, drains, counts] = await Promise.all([
    loadGamepassExport(tab),
    prisma.purchaseBatch.findMany({
      orderBy: { startedAt: "desc" },
      take: 12,
      select: {
        id: true, accountName: true, startedAt: true, finishedAt: true,
        totalGross: true, okCount: true, failCount: true,
      },
    }),
    prisma.drainEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, donorName: true, drainName: true, amount: true, source: true, createdAt: true },
    }),
    loadBuyoutCounts(),
  ]);

  const result = {
    export: gamepassExport,
    batches: batches.map((batch) => ({
      ...batch,
      startedAt: batch.startedAt.toISOString(),
      finishedAt: batch.finishedAt?.toISOString() ?? null,
    })),
    drains: drains.map((drain) => ({ ...drain, createdAt: drain.createdAt.toISOString() })),
    counts,
  };
  logAdminTiming("buyout", startedAt, { tab, coldQueryBudget: 4 });
  return result;
}
