/**
 * Раздел «Риски» (30.10.2026): лента событий — плохие отзывы, исправления,
 * заявки на возврат — и отметка «разобрано». Тот же гейт `requireAdmin`, что
 * у заказов: принимает и веб-сессию, и Bearer TWA.
 *
 * Обработчики живут в lib, а не в `src/app/api/admin/risks/route.ts`: их же
 * отдаёт `/api/twa/risks`, а сборка Guide вырезает `src/app/api/admin` —
 * реэкспорт из папки admin ронял Guide (31.10.2026).
 */
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import { countOpenRisks, loadRiskFeed, setRiskResolved } from "@/lib/risk-feed";

export async function GET(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (req.nextUrl.searchParams.get("count") === "1") {
    return NextResponse.json({ open: await countOpenRisks() });
  }
  const state = req.nextUrl.searchParams.get("state") === "all" ? "all" : "open";
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 80) || 80;
  return NextResponse.json(await loadRiskFeed(state, limit));
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Не указано событие" }, { status: 400 });
  const resolved = body?.action !== "reopen";
  try {
    const row = await setRiskResolved(id, resolved, admin.displayName ?? "админ");
    return NextResponse.json({ ok: true, event: { ...row, resolvedAt: row.resolvedAt?.toISOString() ?? null } });
  } catch {
    return NextResponse.json({ error: "Событие не найдено" }, { status: 404 });
  }
}
