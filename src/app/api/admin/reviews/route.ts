import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || (session.user as any).role !== "ADMIN") {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        const body = await req.json();
        const { author, content, rating, date, isVerified } = body;

        const newReview = await prisma.review.create({
            data: { 
                author, 
                content, 
                rating: rating || 5, 
                date: date || "Сегодня", 
                isVerified: isVerified ?? true 
            }
        });

        return NextResponse.json(newReview);
    } catch (err) {
        console.error("Review Create Error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
