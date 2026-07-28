import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import { prisma } from "@/lib/prisma";
import {
  GAMEPASS_EXPORT_TABS, buildTabWhere, isGamepassExportTab, loadGamepassExport,
} from "@/lib/order-queue";

/**
 * Рабочее место закупщика (A4): выгрузка ID геймпассов, счётчики очередей,
 * история пачек и сливов.
 *
 * Состояние донора сюда НЕ входит намеренно: `getBrowserSession` ходит в
 * серверный браузер с таймаутом 70 с, и выгрузка не должна ждать его. Донор —
 * отдельный роут `/api/admin/buyout/donor`, страница тянет его параллельно.
 */
export async function GET(req: NextRequest) {
  if (!await requireAdmin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const raw = req.nextUrl.searchParams.get("tab") ?? "BUYOUT";
  const tab = isGamepassExportTab(raw) ? raw : "BUYOUT";

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
    // Счётчики по всем выгружаемым вкладкам — чтобы переключатель показывал
    // размер очереди, не заставляя щёлкать по каждой.
    Promise.all(
      GAMEPASS_EXPORT_TABS.map(async (t) => [
        t,
        await prisma.wbOrder.count({ where: { isTest: false, ...buildTabWhere(t) } }),
      ] as const),
    ),
  ]);

  return NextResponse.json({
    export: gamepassExport,
    batches: batches.map((b) => ({
      ...b,
      startedAt: b.startedAt.toISOString(),
      finishedAt: b.finishedAt?.toISOString() ?? null,
    })),
    drains: drains.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
    counts: Object.fromEntries(counts),
  });
}
