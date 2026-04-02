import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any).role !== "ADMIN") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const orderId = id;
    const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: { status: "FULFILLED" },
    });

    return NextResponse.json({ success: true, order: updatedOrder });
  } catch (err) {
    console.error("Fulfillment Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
