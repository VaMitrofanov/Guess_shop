import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { hashGiftToken, isGiftTokenShape } from "@/lib/codes/gift";
import { decryptActivationCode } from "@/lib/codes/secrets";
import { noStore } from "@/lib/codes/http";

export const dynamic = "force-dynamic";

/**
 * «Открыть подарок»: код по токену получателя из письма-открытки. Токен — в
 * теле запроса, не в логах; первый показ фиксируется (`giftOpenedAt`).
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(`codes-gift:${clientIp(req)}`, 12, 1 / 10);
  if (!limit.ok) return NextResponse.json({ error: "Слишком часто." }, { status: 429 });
  const body = await req.json().catch(() => null) as { token?: unknown } | null;
  if (!isGiftTokenShape(body?.token)) return NextResponse.json({ error: "Подарок не найден." }, { status: 404 });
  const order = await prisma.codeOrder.findUnique({
    where: { giftOpenTokenHash: hashGiftToken(body.token) },
    select: { id: true, status: true, giftOpenedAt: true, giftSendAt: true, activationCode: { select: { encryptedValue: true } } },
  });
  if (!order) return NextResponse.json({ error: "Подарок не найден." }, { status: 404 });
  if (order.status === "REFUNDED") return NextResponse.json({ error: "Этот подарок отменён." }, { status: 410 });
  if (order.status !== "ISSUED" || !order.activationCode || (order.giftSendAt && order.giftSendAt.getTime() > Date.now())) {
    return NextResponse.json({ error: "Подарок ещё готовится — загляните чуть позже." }, { status: 409 });
  }
  let code: string;
  try {
    code = decryptActivationCode(order.activationCode.encryptedValue);
  } catch {
    console.error("[codes] gift decrypt failed", { orderId: order.id });
    return NextResponse.json({ error: "Подарок временно недоступен. Напишите в поддержку." }, { status: 500 });
  }
  if (!order.giftOpenedAt) await prisma.codeOrder.update({ where: { id: order.id }, data: { giftOpenedAt: new Date() } });
  return NextResponse.json({ code }, { headers: noStore });
}
