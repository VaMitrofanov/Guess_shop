import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any).role !== "ADMIN") {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json();
    const { name, robuxAmount, rubPrice, type, isActive } = body;

    const updatedProduct = await prisma.product.update({
        where: { id },
        data: {
            name,
            robuxAmount,
            rubPrice,
            type,
            isActive
        }
    });

    return NextResponse.json({ success: true, product: updatedProduct });
  } catch (err) {
    console.error("Product Update Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const session = await getServerSession(authOptions);
        if (!session || (session.user as any).role !== "ADMIN") {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }
    
        await prisma.product.delete({
            where: { id }
        });
    
        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("Product Delete Error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
