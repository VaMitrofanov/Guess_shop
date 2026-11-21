import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { CodeOrderError, findCodeOrderByToken, startCodePayment } from "@/lib/codes/orders";
import { isPayTokenShape } from "@/lib/codes/secrets";
import { codeErrorResponse, noStore } from "@/lib/codes/http";
import { backToPayPage, bankHandoffHtml, formFromOurSite, isFormPost, readForm } from "@/lib/codes/pay-form";

export const dynamic = "force-dynamic";

const Schema = z.object({
  token: z.string(),
  receiptEmail: z.email().max(254).optional(),
  agreedToTerms: z.literal(true),
});

/**
 * Та же оплата из обычной HTML-формы — когда скрипты страницы не ожили
 * (см. `src/lib/codes/pay-form.ts`). Отличается только формой ответа:
 * страница-переход на банк или 303 обратно с кодом ошибки.
 */
async function handleFormPost(req: NextRequest): Promise<NextResponse> {
  const form = await readForm(req);
  const token = form.token ?? "";
  if (!formFromOurSite(req)) return backToPayPage(token, "FAILED");
  if (!rateLimit(`codes-pay:${clientIp(req)}`, 8, 1 / 15).ok) return backToPayPage(token, "LIMIT");
  if (!form.agreedToTerms) return backToPayPage(token, "TERMS");
  const email = form.receiptEmail?.trim() || undefined;
  if (email && (email.length > 254 || !z.email().safeParse(email).success)) return backToPayPage(token, "EMAIL");
  if (!isPayTokenShape(token)) return backToPayPage(token, "NOT_FOUND");
  try {
    const order = await findCodeOrderByToken(token);
    if (!order) return backToPayPage(token, "NOT_FOUND");
    const payment = await startCodePayment(order, email ?? null);
    return new NextResponse(bankHandoffHtml(payment.paymentUrl), {
      status: 200,
      headers: { ...noStore, "content-type": "text/html; charset=utf-8", "referrer-policy": "no-referrer" },
    });
  } catch (error) {
    if (error instanceof CodeOrderError) return backToPayPage(token, error.code);
    console.error("[codes] form pay failed", { error: (error as Error)?.message });
    return backToPayPage(token, "FAILED");
  }
}

/** «Оплатить» на странице ссылки: платёжная сессия создаётся только сейчас. */
export async function POST(req: NextRequest) {
  if (isFormPost(req)) return handleFormPost(req);
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
