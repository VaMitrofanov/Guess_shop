import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type GamepassExportTab, loadGamepassExport } from "@/lib/order-queue";
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
  const workCutoff = new Date(Date.now() - 40 * 60 * 60 * 1000);
  const buyoutOverdue = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const linkOverdue = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<BuyoutCountRow[]>(Prisma.sql`
    SELECT
      COUNT(*) FILTER (
        WHERE "isFavorite" = false
          AND "orderSource"::text <> 'AVITO'
          AND NOT ("isDirectOrder" = true AND "paidAt" IS NULL)
          AND (
            "status"::text IN ('PENDING', 'IN_PROGRESS')
            OR ("status"::text = 'ERROR' AND "buyoutErrorCode" IN ('REGIONAL_PRICE', 'ROBLOX_PLUS_FLOW'))
          )
      ) AS "BUYOUT",
      COUNT(*) FILTER (
        WHERE "isFavorite" = false AND "isDirectOrder" = true
          AND "status"::text IN ('PENDING', 'IN_PROGRESS', 'AWAITING_PAYMENT', 'PAYMENT_PENDING', 'ERROR')
      ) AS "DIRECT",
      COUNT(*) FILTER (
        WHERE "isFavorite" = false AND "orderSource"::text = 'AVITO'
          AND "status"::text IN ('PENDING', 'IN_PROGRESS', 'AWAITING_GAMEPASS', 'ERROR')
      ) AS "AVITO",
      COUNT(*) FILTER (
        WHERE "isFavorite" = false AND (
          "status"::text = 'ERROR'
          OR (
            "status"::text IN ('PENDING', 'IN_PROGRESS')
            AND "orderSource"::text <> 'AVITO'
            AND NOT ("isDirectOrder" = true AND "paidAt" IS NULL)
          )
          OR ("status"::text = 'AWAITING_GAMEPASS' AND "createdAt" <= ${workCutoff})
        )
      ) AS "WORK",
      COUNT(*) FILTER (WHERE "isFavorite" = false AND "status"::text = 'ERROR') AS "ERROR",
      COUNT(*) FILTER (
        WHERE "isFavorite" = false AND (
          "status"::text = 'ERROR'
          OR (
            "status"::text IN ('PENDING', 'IN_PROGRESS')
            AND "orderSource"::text <> 'AVITO'
            AND NOT ("isDirectOrder" = true AND "paidAt" IS NULL)
            AND "pendingAt" <= ${buyoutOverdue}
          )
          OR ("isDirectOrder" = true AND "status"::text IN ('AWAITING_PAYMENT', 'PAYMENT_PENDING'))
          OR ("status"::text = 'AWAITING_GAMEPASS' AND "createdAt" <= ${linkOverdue})
        )
      ) AS "ATTENTION"
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
