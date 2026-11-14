import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { CodeOrderError, findCodeOrderByToken, startCodePayment } from "@/lib/codes/orders";
import { isPayTokenShape } from "@/lib/codes/secrets";
import { codeErrorResponse, noStore } from "@/lib/codes/http";

export const dynamic = "force-dynamic";

const Schema = z.object({
  token: z.string(),
  receiptEmail: z.email().max(254).optional(),
  agreedToTerms: z.literal(true),
});

/** «Оплатить» на странице ссылки: платёжная сессия создаётся только сейчас. */
export async function POST(req: NextRequest) {
  const limit = rateLimit(`codes-pay:${clientIp(req)}`, 8, 1 / 15);
  if (!limit.ok) return NextResponse.json({ error: "Слишком много попыток. Подождите минуту." }, { status: 429 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const terms = parsed.error.issues.some((issue) => issue.path.includes("agreedToTerms"));
    return NextResponse.json({ error: terms ? "Нужно согласие с офертой." : "Проверьте email для чека." }, { status: 400 });
  }
  if (!isPayTokenShape(parsed.data.token)) return codeErrorResponse(new CodeOrderError("NOT_FOUND", "Ссылка не найдена.", 404));
  try {
    const order = await findCodeOrderByToken(parsed.data.token);
    if (!order) throw new CodeOrderError("NOT_FOUND", "Ссылка не найдена.", 404);
    const payment = await startCodePayment(order, parsed.data.receiptEmail ?? null);
    return NextResponse.json({ paymentUrl: payment.paymentUrl }, { headers: noStore });
  } catch (error) {
    return codeErrorResponse(error);
  }
}
