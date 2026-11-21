import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import { loadFirstInLine } from "@/lib/first-in-line";

/**
 * «Первым делом» отдельным адресом — для экранов «Выкупы» (TWA) и «Выкупить»
 * (сайт): у них нет данных главной, а блок обязан быть тем же самым. Без кэша:
 * это ответ на нажатие ⚡ / 🔁 секунду назад.
 */
export async function GET(req: NextRequest) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const data = await loadFirstInLine();
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
