import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import { loadDirectEconomics } from "@/lib/direct-economics";

/**
 * Экономика не-WB заказов для веб-админки. Данные — тот же
 * `loadDirectEconomics`, что и у TWA; отличается только дверь: здесь единый
 * `requireAdmin`, принимающий и сессию, и Bearer-пропуск (A1).
 */
export async function GET(req: NextRequest) {
  if (!await requireAdmin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await loadDirectEconomics());
}
