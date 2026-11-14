import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { decryptActivationCode } from "@/lib/codes/secrets";
import { noStore, sessionUserId } from "@/lib/codes/http";

export const dynamic = "force-dynamic";

/**
 * Показ кода в кабинете — только создателю заказа и только по его сессии.
 * Первый показ фиксируется (`revealedAt`): это и UX, и факт для спора.
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(`codes-reveal:${clientIp(req)}`, 20, 1 / 6);
  if (!limit.ok) return NextResponse.json({ error: "Слишком часто." }, { status: 429 });
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const body = await req.json().catch(() => null) as { orderId?: unknown } | null;
  if (typeof body?.orderId !== "string") return NextResponse.json({ error: "Заказ не найден." }, { status: 404 });

  const order = await prisma.codeOrder.findFirst({
    where: { publicId: body.orderId, creatorUserId: userId, status: "ISSUED" },
    select: { id: true, revealedAt: true, activationCode: { select: { encryptedValue: true } } },
  });
  if (!order?.activationCode) return NextResponse.json({ error: "Заказ не найден." }, { status: 404 });
  let code: string;
  try {
    code = decryptActivationCode(order.activationCode.encryptedValue);
  } catch {
    console.error("[codes] reveal decrypt failed", { orderId: order.id });
    return NextResponse.json({ error: "Код временно недоступен. Напишите в поддержку." }, { status: 500 });
  }
  if (!order.revealedAt) {
    await prisma.codeOrder.update({ where: { id: order.id }, data: { revealedAt: new Date() } });
  }
  return NextResponse.json({ code }, { headers: noStore });
}
