/**
 * Досье покупателя (30.10.2026): заказы, отзывы с правками и заявки по имени
 * покупателя на WB, плюс отметка «проблемный». Имя — единственное, что WB даёт
 * о покупателе, поэтому досье честно предупреждает о тёзках.
 *
 * Обработчики живут в lib, а не в `src/app/api/admin/buyers/route.ts`: их же
 * отдаёт `/api/twa/buyers`, а сборка Guide вырезает `src/app/api/admin` —
 * реэкспорт из папки admin ронял Guide (31.10.2026).
 */
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import { loadBuyerDossier, setBuyerFlag } from "@/lib/risk-feed";

export async function GET(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const name = (req.nextUrl.searchParams.get("name") ?? "").slice(0, 120);
  const dossier = await loadBuyerDossier(name);
  if (!dossier) return NextResponse.json({ error: "Имя покупателя пустое" }, { status: 400 });
  return NextResponse.json(dossier);
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" ? body.name : "";
  try {
    const flag = await setBuyerFlag({
      key: name,
      displayName: typeof body?.displayName === "string" ? body.displayName : name,
      note: typeof body?.note === "string" ? body.note : null,
      actor: admin.displayName ?? "админ",
      on: body?.action !== "unflag",
    });
    return NextResponse.json({ ok: true, flag });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не сохранилось" }, { status: 400 });
  }
}
