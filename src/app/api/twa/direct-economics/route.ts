import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { loadDirectEconomics } from "@/lib/direct-economics";

/**
 * Тонкий алиас на общий загрузчик — та же экономика, что отдаёт веб-админка
 * (`/api/admin/economics`). Логика живёт в `@/lib/direct-economics`, чтобы две
 * поверхности не считали деньги по-разному (docs/admin-console-plan.md §6).
 */
export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await loadDirectEconomics());
}
