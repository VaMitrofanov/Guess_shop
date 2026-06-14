import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";

let cached: { count: number; ts: number } | null = null;
const TTL = 20_000;

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (cached && Date.now() - cached.ts < TTL) {
    return NextResponse.json({ count: cached.count });
  }
  const count = await (prisma as any).wbOrder.count({
    where: { status: { in: ["AWAITING_PAYMENT", "PAYMENT_PENDING", "PENDING", "IN_PROGRESS"] }, isTest: false },
  });
  cached = { count, ts: Date.now() };
  return NextResponse.json({ count });
}
