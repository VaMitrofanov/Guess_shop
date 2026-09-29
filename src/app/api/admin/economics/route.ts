import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import { loadDirectEconomics } from "@/lib/direct-economics";

/**
 * Экономика не-WB заказов для веб-админки. Данные — тот же
 * `loadDirectEconomics`, что и у TWA; отличается только дверь: здесь единый
 * `requireAdmin`, принимающий и сессию, и Bearer-пропуск (A1).
 */
export async function GET(req: NextRequest) {
  const startedAt = performance.now();
  if (!await requireAdmin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authMs = performance.now() - startedAt;
  const data = await loadDirectEconomics();
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "private, no-store",
      "Server-Timing": `auth;dur=${authMs.toFixed(1)}, data;dur=${(performance.now() - startedAt - authMs).toFixed(1)}`,
    },
  });
}
