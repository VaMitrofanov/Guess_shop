import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const UpdateReviewSchema = z.object({
  author:     z.string().min(1).max(100).optional(),
  content:    z.string().min(1).max(2000).optional(),
  rating:     z.number().int().min(1).max(5).optional(),
  date:       z.string().max(50).optional(),
  isVerified: z.boolean().optional(),
});

function isValidId(id: string) { return /^[a-z0-9]{20,30}$/.test(id); }
async function requireAdmin() {
  const session = await auth();
  return (!session || (session.user as any).role !== "ADMIN") ? null : session;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isValidId(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

    const parsed = UpdateReviewSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 400 });

    const review = await prisma.review.update({ where: { id }, data: parsed.data });
    return NextResponse.json(review);
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isValidId(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    await prisma.review.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
