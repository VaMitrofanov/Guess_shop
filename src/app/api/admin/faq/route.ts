import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";

export async function GET() {
    const faqs = await prisma.fAQ.findMany({ orderBy: { order: 'asc' } });
    return NextResponse.json(faqs);
}

export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || (session.user as any).role !== "ADMIN") {
            return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }

        const body = await req.json();
        const { question, answer } = body;

        const newFaq = await prisma.fAQ.create({
            data: { question, answer }
        });

        return NextResponse.json(newFaq);
    } catch (err) {
        console.error("FAQ Create Error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
