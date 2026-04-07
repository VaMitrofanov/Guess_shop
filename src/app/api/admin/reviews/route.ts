import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CreateReviewSchema = z.object({
  author:     z.string().min(1).max(100),
  content:    z.string().min(1).max(2000),
  rating:     z.number().int().min(1).max(5).default(5),
  date:       z.string().max(50).default("Сегодня"),
  isVerified: z.boolean().default(true),
});

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  return (!session || (session.user as any).role !== "ADMIN") ? null : session;
}

export async function GET() {
  try {
    const reviews = await prisma.review.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json(reviews);
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

    const parsed = CreateReviewSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 400 });

    const review = await prisma.review.create({ data: parsed.data });
    return NextResponse.json(review);
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
