import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";
import { computeEnrichment } from "@/lib/order-enrich";
import { checkVkReachable } from "@/lib/vk-reach";

// Заказ ещё «живой» — недостижимость клиента блокирует работу менеджера.
const VK_CHECK_STATUSES = new Set([
  "AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR", "AWAITING_PAYMENT", "PAYMENT_PENDING",
]);

/**
 * Deferred enrichment for the Orders list.
 *
 * The list is fetched in lite mode (fast, no enrichment). After it paints, the
 * client calls this with the visible order ids; we return only the per-order
 * signals — { userOrderNumber, userOrderTotal, reviewStatus, vkUnreachable } —
 * which the UI merges in. Capped at 60 ids (a few pages) to keep it a single
 * cheap batch. vkUnreachable = сообщество не может написать юзеру (VK 901),
 * менеджер должен писать с личного аккаунта (PLAN +5.I.1).
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

  const vkIds = orders
    .filter((o: any) => o.user?.vkId && !o.user?.tgId && VK_CHECK_STATUSES.has(o.status))
    .map((o: any) => String(o.user.vkId));

  const [enrich, reach] = await Promise.all([
    computeEnrichment(orders),
    vkIds.length > 0 ? checkVkReachable(vkIds) : Promise.resolve(new Map<string, boolean>()),
  ]);

  for (const o of orders) {
    const vkId = o.user?.vkId ? String(o.user.vkId) : null;
    if (!vkId || !reach.has(vkId)) continue;
    const unreachable = reach.get(vkId) === false;
    if (enrich[o.id]) (enrich[o.id] as any).vkUnreachable = unreachable;
    else (enrich as any)[o.id] = { userOrderNumber: null, userOrderTotal: null, reviewStatus: null, vkUnreachable: unreachable };
  }

  return NextResponse.json({ enrich });
}
