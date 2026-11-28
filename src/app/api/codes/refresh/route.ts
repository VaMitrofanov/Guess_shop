import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { CodeOrderError, findCodeOrderByToken, publicCodeOrderView, refreshCodeOffer } from "@/lib/codes/orders";
import { isPayTokenShape } from "@/lib/codes/secrets";
import { codeErrorResponse, noStore } from "@/lib/codes/http";
import { backToPayPage, formFromOurSite, isFormPost, readForm } from "@/lib/codes/pay-form";

export const dynamic = "force-dynamic";

/** Подтверждение обновлённого заказа после истечения срока предложения. */
export async function POST(req: NextRequest) {
  // Без скриптов «Подтвердить за …» — обычная форма: обновляем и возвращаем на страницу.
  if (isFormPost(req)) {
    const token = (await readForm(req)).token ?? "";
    if (!formFromOurSite(req)) return backToPayPage(token, "FAILED");
    if (!rateLimit(`codes-refresh:${clientIp(req)}`, 6, 1 / 20).ok) return backToPayPage(token, "LIMIT");
    if (!isPayTokenShape(token)) return backToPayPage(token, "NOT_FOUND");
    try {
      const order = await findCodeOrderByToken(token);
      if (!order) return backToPayPage(token, "NOT_FOUND");
      await refreshCodeOffer(order);
      return backToPayPage(token);
    } catch (error) {
      if (error instanceof CodeOrderError) return backToPayPage(token, error.code);
      console.error("[codes] form refresh failed", { error: (error as Error)?.message });
      return backToPayPage(token, "FAILED");
    }
  }
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
