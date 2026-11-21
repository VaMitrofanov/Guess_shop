import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { findCodeOrderByToken } from "@/lib/codes/orders";
import { isPayTokenShape } from "@/lib/codes/secrets";
import { noStore } from "@/lib/codes/http";

export const dynamic = "force-dynamic";

/**
 * «Всё прошло нормально?» с экрана после оплаты (витрина 2.0). Оценить можно
 * только оплаченный заказ и только по его ссылке; повтор меняет оценку.
 * Публично оценки не показываются — это сигнал нам, а не «★4,9» на витрине.
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(`codes-rate:${clientIp(req)}`, 10, 1 / 30);
  if (!limit.ok) return NextResponse.json({ error: "Слишком часто." }, { status: 429 });
  const body = await req.json().catch(() => null) as { token?: unknown; stars?: unknown } | null;
  const stars = Number(body?.stars);
  if (!isPayTokenShape(body?.token) || !Number.isInteger(stars) || stars < 1 || stars > 5) {
    return NextResponse.json({ error: "Некорректная оценка." }, { status: 400 });
  }
  const order = await findCodeOrderByToken(body.token);
  if (!order || !order.paidAt) return NextResponse.json({ error: "Заказ не найден." }, { status: 404 });
  await prisma.codeOrder.update({ where: { id: order.id }, data: { rating: stars, ratedAt: new Date() } });
  return NextResponse.json({ ok: true, stars }, { headers: noStore });
}
