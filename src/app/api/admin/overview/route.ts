import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import { getAdminOverview } from "@/lib/admin-overview";
import { ADMIN_WINDOW_MAX_DAYS } from "@/lib/admin-presence";

/**
 * Данные «Обзора» для обновления на месте.
 *
 * Присутствие здесь НЕ отмечается намеренно. Отметку двигает только загрузка
 * страницы (серверный компонент): если бы её двигало и обновление, окно
 * «Пока вас не было» схлопывалось бы само каждую минуту и всегда показывало
 * пустоту. Поэтому окно приходит параметром `since` — тем же, что страница
 * получила при заходе.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!await requireAdmin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const raw = req.nextUrl.searchParams.get("since");
  const parsed = raw ? Date.parse(raw) : Number.NaN;
  const floor = Date.now() - ADMIN_WINDOW_MAX_DAYS * 86_400_000;
  // Окно из адресной строки не должно превращаться в запрос за всю историю:
  // клиент может прислать что угодно, потолок тот же, что у присутствия.
  const since = Number.isFinite(parsed)
    ? new Date(Math.min(Date.now(), Math.max(floor, parsed)))
    : new Date(Date.now() - 24 * 3600_000);

  return NextResponse.json(await getAdminOverview(since));
}
