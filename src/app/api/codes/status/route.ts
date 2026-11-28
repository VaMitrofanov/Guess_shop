import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { findCodeOrderByToken, publicCodeOrderView } from "@/lib/codes/orders";
import { isPayTokenShape } from "@/lib/codes/secrets";
import { codeErrorResponse, noStore } from "@/lib/codes/http";

export const dynamic = "force-dynamic";

/** Безопасный статус по ссылке (токен в теле, а не в адресе — не оседает в логах). */
export async function POST(req: NextRequest) {
  const limit = rateLimit(`codes-status:${clientIp(req)}`, 30, 1);
  if (!limit.ok) return NextResponse.json({ error: "Слишком часто." }, { status: 429 });
  const body = await req.json().catch(() => null) as { token?: unknown } | null;
  if (!isPayTokenShape(body?.token)) return NextResponse.json({ error: "Ссылка не найдена." }, { status: 404 });
  try {
    const order = await findCodeOrderByToken(body.token);
    if (!order) return NextResponse.json({ error: "Ссылка не найдена." }, { status: 404 });
    return NextResponse.json(await publicCodeOrderView(order), { headers: noStore });
  } catch (error) {
    return codeErrorResponse(error);
  }
}
