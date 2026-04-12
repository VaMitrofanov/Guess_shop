import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CreateFAQSchema = z.object({
  question: z.string().min(1).max(500),
  answer:   z.string().min(1).max(5000),
  order:    z.number().int().min(0).optional().default(0),
});

async function requireAdmin() {
  const session = await auth();
  return (!session || (session.user as any).role !== "ADMIN") ? null : session;
}

export async function GET() {
  try {
    const faqs = await prisma.fAQ.findMany({ orderBy: { order: "asc" } });
    return NextResponse.json(faqs);
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

    const body = await req.json();
    const parsed = CreateFAQSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 400 });
    }

    const faq = await prisma.fAQ.create({ data: parsed.data });
    return NextResponse.json(faq);
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
