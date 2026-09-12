import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { orderStatusTokenMatches } from "@/lib/order-status-access";
import {
  canOfferPostPurchaseChannels,
  isPostPurchaseChannelDestination,
  postPurchaseChannelEventType,
} from "@/lib/post-purchase-channel";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = rateLimit(`post-purchase-channel:${clientIp(req)}`, 12, 1 / 5);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }

  const { id } = await params;
  const input = await req.json().catch(() => null) as { destination?: unknown } | null;
  if (!isPostPurchaseChannelDestination(input?.destination)) {
    return NextResponse.json({ error: "Invalid destination" }, { status: 400 });
  }

  const order = await prisma.wbOrder.findUnique({
    where: { publicOrderId: id },
    select: {
      id: true,
      userId: true,
      statusTokenHash: true,
      status: true,
      paymentAttempts: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true },
      },
    },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const session = await auth();
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (sessionUserId !== order.userId && !orderStatusTokenMatches(token, order.statusTokenHash)) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const paymentStatus = order.paymentAttempts[0]?.status ?? null;
  if (!canOfferPostPurchaseChannels(order.status, paymentStatus)) {
    return NextResponse.json({ error: "Payment is not confirmed" }, { status: 409 });
  }

  const eventType = postPurchaseChannelEventType(input.destination);
  await prisma.orderEvent.upsert({
    where: { idempotencyKey: `post-purchase-channel:${order.id}:${input.destination}` },
    update: {},
    create: {
      orderId: order.id,
      type: eventType,
      idempotencyKey: `post-purchase-channel:${order.id}:${input.destination}`,
      payload: { destination: input.destination, surface: "payment-status" },
    },
  });

  return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
}
