import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { CODE_LIST_SEPARATOR, issuedCodesForOrder } from "@/lib/codes/order-codes";
import { noStore, sessionUserId } from "@/lib/codes/http";
import { notifyCodeOpened } from "@/lib/codes/admin-notify";

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
    select: { id: true, revealedAt: true, deliveryMode: true, giftOpenTokenHash: true, activationCodeId: true },
  });
  if (!order?.activationCodeId) return NextResponse.json({ error: "Заказ не найден." }, { status: 404 });
  // Подаренный из кабинета код открывает получатель (19.11.2026): иначе его
  // легко ввести самому и подарить «пустышку». «Вернуть себе» снимает запрет.
  if (order.deliveryMode !== "GIFT" && order.giftOpenTokenHash) {
    return NextResponse.json({ error: "Этот код подарен — его откроет получатель. Чтобы забрать, нажмите «Вернуть себе»." }, { status: 409 });
  }
  let codes: string[];
  try {
    codes = await issuedCodesForOrder(order.id);
    if (!codes.length) throw new Error("no issued codes");
  } catch {
    console.error("[codes] reveal decrypt failed", { orderId: order.id });
    return NextResponse.json({ error: "Код временно недоступен. Напишите в поддержку." }, { status: 500 });
  }
  if (!order.revealedAt) {
    // updateMany с условием — защёлка: два параллельных показа дают один увед.
    const first = await prisma.codeOrder.updateMany({ where: { id: order.id, revealedAt: null }, data: { revealedAt: new Date() } });
    if (first.count === 1) void notifyCodeOpened(order.id, "cabinet");
  }
  // Набор (2 × 1 000) — коды строками: клиент показывает каждый со своей кнопкой.
  return NextResponse.json({ code: codes.join(CODE_LIST_SEPARATOR), codes }, { headers: noStore });
}
