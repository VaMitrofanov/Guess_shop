import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { findCodeOrderByToken } from "@/lib/codes/orders";
import { isPayTokenShape, maskEmail } from "@/lib/codes/secrets";
import { sendCodeEmail } from "@/lib/codes/delivery";
import { noStore, sessionUserId } from "@/lib/codes/http";

export const dynamic = "force-dynamic";

/**
 * Повторная отправка письма с ТЕМ ЖЕ кодом на ТОТ ЖЕ адрес из заказа.
 * По общей ссылке можно только попросить отправить — увидеть код или сменить
 * адрес нельзя. Клиент может переотправить из кабинета свой заказ.
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(`codes-resend:${clientIp(req)}`, 3, 1 / 120);
  if (!limit.ok) return NextResponse.json({ error: "Письмо уже отправляли — подождите пару минут." }, { status: 429 });
  const body = await req.json().catch(() => null) as { token?: unknown; orderId?: unknown } | null;

  let orderId: string | null = null;
  if (isPayTokenShape(body?.token)) {
    orderId = (await findCodeOrderByToken(body.token))?.id ?? null;
  } else if (typeof body?.orderId === "string") {
    const userId = await sessionUserId();
    if (userId) {
      const own = await prisma.codeOrder.findFirst({ where: { publicId: body.orderId, creatorUserId: userId }, select: { id: true } });
      orderId = own?.id ?? null;
    }
  }
  if (!orderId) return NextResponse.json({ error: "Заказ не найден." }, { status: 404 });

  const result = await sendCodeEmail(orderId, "resend");
  const order = await prisma.codeOrder.findUnique({
    where: { id: orderId },
    select: { deliveryMode: true, recipientEmail: true, creator: { select: { email: true } } },
  });
  const to = maskEmail(order?.deliveryMode === "EMAIL" || order?.deliveryMode === "GIFT" ? order?.recipientEmail : order?.creator?.email);
  const messages: Record<typeof result, [number, string]> = {
    sent: [200, `Письмо отправлено${to ? ` на ${to}` : ""}.`],
    no_address: [409, "У аккаунта нет подтверждённой почты — код доступен в личном кабинете."],
    not_issued: [409, "Код ещё не выдан — письмо придёт сразу после подтверждения оплаты."],
    failed: [502, "Почта не ответила. Код сохранён — попробуйте ещё раз чуть позже."],
    exhausted: [429, "Слишком много повторов. Напишите в поддержку — код сохранён в заказе."],
    scheduled: [409, "Открытка уйдёт в выбранный день — раньше отправить её нельзя."],
  };
  const [status, message] = messages[result];
  return NextResponse.json({ result, message }, { status, headers: noStore });
}
