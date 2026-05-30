import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";

/**
 * Tiny counter for the BottomNav "Orders" badge.
 *
 * Replaces the prior 30s polling of /api/twa/orders?status=PENDING&limit=1,
 * which ran the full pipeline (page fetch + 6 chip COUNTs + numbering +
 * reviewStatus + VK enrich) just to compute one integer. Now: one COUNT
 * hitting the existing @@index([status]).
 */
export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const count = await (prisma as any).wbOrder.count({
    where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
  });
  return NextResponse.json({ count });
}
