import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";

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
    const { author, content, rating, date, isVerified } = body;

    const updatedReview = await prisma.review.update({
        where: { id },
        data: { author, content, rating, date, isVerified }
    });

    return NextResponse.json(updatedReview);
  } catch (err) {
    console.error("Review Update Error:", err);
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
    
        await prisma.review.delete({ where: { id } });
    
        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("Review Delete Error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
