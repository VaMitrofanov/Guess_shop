import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { CodeOrderError, findCodeOrderByToken, publicCodeOrderView, refreshCodeOffer } from "@/lib/codes/orders";
import { isPayTokenShape } from "@/lib/codes/secrets";
import { codeErrorResponse, noStore } from "@/lib/codes/http";

export const dynamic = "force-dynamic";

/** Подтверждение обновлённого заказа после истечения срока предложения. */
export async function POST(req: NextRequest) {
  const limit = rateLimit(`codes-refresh:${clientIp(req)}`, 6, 1 / 20);
  if (!limit.ok) return NextResponse.json({ error: "Слишком много попыток." }, { status: 429 });
  const body = await req.json().catch(() => null) as { token?: unknown } | null;
  if (!isPayTokenShape(body?.token)) return codeErrorResponse(new CodeOrderError("NOT_FOUND", "Ссылка не найдена.", 404));
  try {
    const order = await findCodeOrderByToken(body.token);
    if (!order) throw new CodeOrderError("NOT_FOUND", "Ссылка не найдена.", 404);
    await refreshCodeOffer(order);
    const fresh = await findCodeOrderByToken(body.token);
    return NextResponse.json(await publicCodeOrderView(fresh!), { headers: noStore });
  } catch (error) {
    return codeErrorResponse(error);
  }
}
