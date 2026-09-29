import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { orderStatusTokenMatches } from "@/lib/order-status-access";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(`order-status:${clientIp(req)}`, 30, 1);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }
  const { id } = await params;
  const order = await prisma.wbOrder.findUnique({
    where: { publicOrderId: id },
    select: {
      publicOrderId: true,
      userId: true,
      statusTokenHash: true,
      status: true,
      amount: true,
      paymentAmountKopecks: true,
      createdAt: true,
      paymentAttempts: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, provider: true, paymentUrl: true },
      },
    },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const session = await auth();
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (sessionUserId !== order.userId && !orderStatusTokenMatches(token, order.statusTokenHash)) {
    // Do not reveal whether a predictable/public id exists.
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  return NextResponse.json({
    orderId: order.publicOrderId,
    status: order.status,
    paymentStatus: order.paymentAttempts[0]?.status ?? null,
    paymentProvider: order.paymentAttempts[0]?.provider ?? null,
    paymentUrl: order.paymentAttempts[0]?.paymentUrl ?? null,
    amountRobux: order.amount,
    amountKopecks: order.paymentAmountKopecks,
    createdAt: order.createdAt,
  }, { headers: { "cache-control": "no-store" } });
}
