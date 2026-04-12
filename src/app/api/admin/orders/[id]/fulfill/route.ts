import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function isValidId(id: string) { return /^[a-z0-9]{20,30}$/.test(id); }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isValidId(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

    const session = await auth();
    if (!session || (session.user as any).role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Verify order exists before updating
    const existing = await prisma.order.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const order = await prisma.order.update({
      where: { id },
      data: { status: "FULFILLED" },
    });

    return NextResponse.json({ success: true, order });
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
