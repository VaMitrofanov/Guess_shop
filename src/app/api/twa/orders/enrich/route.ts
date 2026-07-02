import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";
import { computeEnrichment } from "@/lib/order-enrich";

/**
 * Deferred enrichment for the Orders list.
 *
 * The list is fetched in lite mode (fast, no enrichment). After it paints, the
 * client calls this with the visible order ids; we return only the per-order
 * signals — { userOrderNumber, userOrderTotal, reviewStatus } — which the UI
 * merges in. Capped at 60 ids (a few pages) to keep it a single cheap batch.
 */
export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const idsParam = (req.nextUrl.searchParams.get("ids") ?? "").trim();
  if (!idsParam) return NextResponse.json({ enrich: {} });

  const ids = idsParam.split(",").map(s => s.trim()).filter(Boolean).slice(0, 60);
  if (ids.length === 0) return NextResponse.json({ enrich: {} });

  const orders = await (prisma as any).wbOrder.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, userId: true, status: true, isDirectOrder: true,
      wbCode: true, createdAt: true, robloxUsername: true,
      user: { select: { tgId: true, vkId: true } },
    },
  });

  const enrich = await computeEnrichment(orders);
  return NextResponse.json({ enrich });
}
