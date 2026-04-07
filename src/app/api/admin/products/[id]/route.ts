import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const UpdateProductSchema = z.object({
  name:        z.string().min(1).max(255).optional(),
  robuxAmount: z.number().int().min(1).max(1_000_000).optional(),
  rubPrice:    z.number().positive().max(1_000_000).optional(),
  type:        z.enum(["Gamepass", "Other"]).optional(),
  isActive:    z.boolean().optional(),
});

// CUID/alphanumeric ID guard
function isValidId(id: string): boolean {
  return /^[a-z0-9]{20,30}$/.test(id);
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  return (!session || (session.user as any).role !== "ADMIN") ? null : session;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isValidId(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

    const session = await requireAdmin();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

    const body = await req.json();
    const parsed = UpdateProductSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 400 });
    }

    const product = await prisma.product.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ success: true, product });
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

    await prisma.product.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
