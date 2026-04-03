import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any).role !== "ADMIN") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json();
    const { name, robuxAmount, rubPrice, type } = body;

    if (!name || !robuxAmount || !rubPrice) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const product = await prisma.product.create({
        data: {
            name,
            robuxAmount: parseInt(robuxAmount),
            rubPrice: parseFloat(rubPrice),
            type: type || "Gamepass",
            isActive: true
        }
    });

    return NextResponse.json({ success: true, product });
  } catch (err) {
    console.error("Product Create Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
