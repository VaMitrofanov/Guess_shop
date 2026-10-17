import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import { loadAdminBuyoutData } from "@/lib/admin-buyout";
import { isGamepassExportTab } from "@/lib/order-queue";

/**
 * Рабочее место закупщика (A4): выгрузка ID геймпассов, счётчики очередей,
 * история пачек и сливов.
 *
 * Состояние донора сюда НЕ входит намеренно: `getBrowserSession` ходит в
 * серверный браузер с таймаутом 70 с, и выгрузка не должна ждать его. Донор —
 * отдельный роут `/api/admin/buyout/donor`, страница тянет его параллельно.
 */
export async function GET(req: NextRequest) {
  const startedAt = performance.now();
  if (!await requireAdmin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authMs = performance.now() - startedAt;

  const raw = req.nextUrl.searchParams.get("tab") ?? "BUYOUT";
  const tab = isGamepassExportTab(raw) ? raw : "BUYOUT";

  const data = await loadAdminBuyoutData(tab);
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "private, no-store",
      "Server-Timing": `auth;dur=${authMs.toFixed(1)}, data;dur=${(performance.now() - startedAt - authMs).toFixed(1)}`,
    },
  });
}
