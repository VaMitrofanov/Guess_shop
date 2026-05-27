import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";
import { notifyOrderCompleted, notifyOrderRejected } from "@/lib/twa-notify";

const VALID_STATUSES = ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "COMPLETED", "REJECTED"] as const;
type OrderStatus = typeof VALID_STATUSES[number];

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const status  = searchParams.get("status") as OrderStatus | "ALL" | null;
  const page    = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit   = Math.min(50, Math.max(5, parseInt(searchParams.get("limit") ?? "20", 10)));
  const skip    = (page - 1) * limit;

  const where = (status && status !== "ALL" && VALID_STATUSES.includes(status as OrderStatus))
    ? { status: status as OrderStatus }
    : {};

  const [orders, total, counts] = await Promise.all([
    (prisma as any).wbOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true, amount: true, gamepassUrl: true, status: true,
        platform: true, wbCode: true, rejectionReason: true,
        isDirectOrder: true, paymentDetails: true,
        createdAt: true, updatedAt: true,
        customerRobloxUser: true,
        user: { select: { tgId: true, vkId: true, name: true } },
      },
    }),
    (prisma as any).wbOrder.count({ where }),
    Promise.all(
      [...VALID_STATUSES, "ALL"].map(async s => {
        const w = s === "ALL" ? {} : { status: s };
        const count = await (prisma as any).wbOrder.count({ where: w });
        return [s, count] as [string, number];
      })
    ).then(entries => Object.fromEntries(entries)),
  ]);

  return NextResponse.json({ orders, total, counts, page, pages: Math.ceil(total / limit) });
}

export async function POST(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.action || !body?.orderId)
    return NextResponse.json({ error: "action and orderId required" }, { status: 400 });

  const { action, orderId, reason } = body;

  const order = await (prisma as any).wbOrder.findUnique({
    where: { id: orderId },
    include: { user: { select: { id: true, tgId: true, vkId: true } } },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  if (action === "take-work") {
    if (order.status !== "PENDING")
      return NextResponse.json({ error: "Order must be PENDING" }, { status: 400 });
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data:  { status: "IN_PROGRESS" },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "complete") {
    if (!["PENDING", "IN_PROGRESS"].includes(order.status))
      return NextResponse.json({ error: "Order must be PENDING or IN_PROGRESS" }, { status: 400 });
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data:  { status: "COMPLETED" },
    });
    notifyOrderCompleted(order.user, orderId, order.amount, order.isDirectOrder).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (action === "reject") {
    if (!["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS"].includes(order.status))
      return NextResponse.json({ error: "Cannot reject this order" }, { status: 400 });
    const rejectionReason = String(reason ?? "не указана");
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data:  { status: "REJECTED", rejectionReason },
    });
    notifyOrderRejected(order.user, orderId, rejectionReason, order.amount).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
