import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import { getWbBalance } from "@/lib/wb-api";
import { loadOpenClaims } from "@/lib/wb-claims-open";

/* 💰 Баланс кабинета WB и ↩ заявки на возврат, ждущие решения, — для главной
   сайта /admin (27.11.2026). TWA получает то же внутри `/api/twa/dashboard`. */
export async function GET(req: NextRequest) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [wbBalance, openClaims] = await Promise.all([
    getWbBalance().catch(() => null),
    loadOpenClaims(8).catch(() => ({ total: 0, rows: [] })),
  ]);
  return NextResponse.json({ wbBalance, openClaims });
}
