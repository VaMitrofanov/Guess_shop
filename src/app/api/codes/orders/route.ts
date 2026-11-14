import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createCodeOrder, findCodeOrderByToken, startCodePayment } from "@/lib/codes/orders";
import { claimReferralFromCookies, codeErrorResponse, noStore, sessionUserId } from "@/lib/codes/http";

export const dynamic = "force-dynamic";

const Schema = z.object({
  denomination: z.number().int().positive(),
  mode: z.enum(["self", "share"]),
  email: z.email().max(254).optional(),
  receiptEmail: z.email().max(254).optional(),
  agreedToTerms: z.boolean().optional(),
  idempotencyKey: z.uuid(),
});

/**
 * Создать заказ кода. `self` — сразу платёжная сессия банка; `share` — только
 * сохранённый заказ и ссылка для другого человека (банк — когда он нажмёт
 * «Оплатить»). Получатель: гость — email из формы, клиент — его кабинет.
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(`codes-order:${clientIp(req)}`, 6, 1 / 20);
  if (!limit.ok) {
    return NextResponse.json({ error: "Слишком много попыток. Подождите минуту." }, { status: 429, headers: { "retry-after": String(limit.retryAfter) } });
  }
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const emailIssue = parsed.error.issues.some((issue) => issue.path.includes("email"));
    return NextResponse.json({ error: emailIssue ? "Проверьте email — в нём ошибка." : "Некорректные параметры заказа." }, { status: 400 });
  }
  const input = parsed.data;
  if (input.mode === "self" && input.agreedToTerms !== true) {
    return NextResponse.json({ error: "Нужно согласие с офертой.", code: "TERMS_REQUIRED" }, { status: 400 });
  }

  const userId = await sessionUserId();
  if (userId) await claimReferralFromCookies(userId);
  try {
    const { order, token, reused } = await createCodeOrder({
      denomination: input.denomination,
      userId,
      recipientEmail: userId ? null : input.email ?? null,
      createdVia: input.mode === "share" ? "SHARE" : "SELF",
      idempotencyKey: input.idempotencyKey,
    });
    const payPath = `/pay/${token}`;
    const base = {
      orderId: order.publicId,
      payPath,
      finalAmountKopecks: order.finalAmountKopecks,
      discountPercent: order.discountPercent,
      offerExpiresAt: order.offerExpiresAt.toISOString(),
      reused,
    };
    if (input.mode === "share") return NextResponse.json(base, { status: reused ? 200 : 201, headers: noStore });

    const full = await findCodeOrderByToken(token);
    if (!full) throw new Error("order vanished");
    const payment = await startCodePayment(full, input.receiptEmail ?? null);
    return NextResponse.json({ ...base, paymentUrl: payment.paymentUrl }, { status: 201, headers: noStore });
  } catch (error) {
    return codeErrorResponse(error);
  }
}
