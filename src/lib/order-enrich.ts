/* ─────────────────────────────────────────────────────────────────────────────
   order-enrich.ts — cluster numbering + review-status for WB orders.

   Extracted from /api/twa/orders so it can run as a deferred, batched step
   AFTER the order list has already painted (lite mode). The list stays fast;
   the "Nth order / VIP / review" signals fill in a beat later. This is the
   same algorithm the old non-lite path used — just callable in isolation.

   Cluster = the same person across their TG / VK / Roblox identity union.
   Review status applies only to a user's FIRST completed, non-direct WB order.
   ───────────────────────────────────────────────────────────────────────── */
import { prisma } from "@/lib/prisma";

export interface EnrichOrder {
  id: string;
  userId: string;
  status: string;
  isDirectOrder: boolean;
  wbCode: string;
  createdAt: Date | string;
  robloxUsername: string | null;
  user: { tgId: string | null; vkId: string | null } | null;
}

export interface EnrichValue {
  userOrderNumber: number | null;
  userOrderTotal: number | null;
  reviewStatus: "PENDING" | "SUBMITTED" | null;
}

export async function computeEnrichment(
  orders: EnrichOrder[],
): Promise<Record<string, EnrichValue>> {
  const result: Record<string, EnrichValue> = {};
  if (orders.length === 0) return result;

  const pageTgIds       = new Set<string>();
  const pageVkIds       = new Set<string>();
  const pageRobloxNicks = new Set<string>();
  for (const o of orders) {
    if (o.user?.tgId)     pageTgIds.add(String(o.user.tgId));
    if (o.user?.vkId)     pageVkIds.add(String(o.user.vkId));
    if (o.robloxUsername) pageRobloxNicks.add(String(o.robloxUsername));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clusterOrClauses: any[] = [];
  if (pageTgIds.size       > 0) clusterOrClauses.push({ user: { tgId: { in: [...pageTgIds] } } });
  if (pageVkIds.size       > 0) clusterOrClauses.push({ user: { vkId: { in: [...pageVkIds] } } });
  if (pageRobloxNicks.size > 0) clusterOrClauses.push({ robloxUsername: { in: [...pageRobloxNicks] } });

  const completedWbOrders = orders.filter(o => o.status === "COMPLETED" && !o.isDirectOrder);
  const wbCodeValues      = completedWbOrders.map(o => o.wbCode);
  const uniqueUserIds     = [...new Set<string>(completedWbOrders.map(o => o.userId))];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [clusterOrders, codeRecords, firstOrderRows]: [any[], any[], any[]] = await Promise.all([
    clusterOrClauses.length > 0
      ? (prisma as any).wbOrder.findMany({
          where: { OR: clusterOrClauses },
          select: { createdAt: true, robloxUsername: true, user: { select: { tgId: true, vkId: true } } },
        })
      : Promise.resolve([]),
    completedWbOrders.length > 0
      ? (prisma as any).wbCode.findMany({
          where: { code: { in: wbCodeValues } },
          select: { code: true, reviewBonusClaimed: true },
        })
      : Promise.resolve([]),
    completedWbOrders.length > 0
      ? (prisma as any).wbOrder.groupBy({
          by: ["userId"],
          where: { userId: { in: uniqueUserIds }, status: "COMPLETED", isDirectOrder: false },
          _min: { createdAt: true },
        })
      : Promise.resolve([]),
  ]);

  // ── Cluster numbering ──────────────────────────────────────────────────────
  for (const order of orders) {
    const myTg     = order.user?.tgId     ?? null;
    const myVk     = order.user?.vkId     ?? null;
    const myRoblox = order.robloxUsername ?? null;
    if (!myTg && !myVk && !myRoblox) {
      result[order.id] = { userOrderNumber: 1, userOrderTotal: 1, reviewStatus: null };
      continue;
    }
    const myCreated = new Date(order.createdAt).getTime();
    let cnt = 0, earlier = 0;
    for (const c of clusterOrders) {
      const match =
        (myTg     && c.user?.tgId === myTg) ||
        (myVk     && c.user?.vkId === myVk) ||
        (myRoblox && c.robloxUsername === myRoblox);
      if (!match) continue;
      cnt++;
      if (new Date(c.createdAt).getTime() < myCreated) earlier++;
    }
    result[order.id] = { userOrderNumber: earlier + 1, userOrderTotal: cnt, reviewStatus: null };
  }

  // ── Review status (first completed non-direct order only) ───────────────────
  if (completedWbOrders.length > 0) {
    const reviewClaimedMap = new Map<string, boolean>(
      codeRecords.map((c) => [c.code as string, c.reviewBonusClaimed as boolean]),
    );
    const firstCreatedByUser = new Map<string, number>(
      firstOrderRows
        .filter((r) => r._min?.createdAt)
        .map((r) => [r.userId as string, new Date(r._min.createdAt).getTime()]),
    );
    for (const order of completedWbOrders) {
      const firstAt = firstCreatedByUser.get(order.userId);
      const isFirstOrder = firstAt !== undefined && new Date(order.createdAt).getTime() === firstAt;
      const reviewStatus: EnrichValue["reviewStatus"] = isFirstOrder
        ? (reviewClaimedMap.get(order.wbCode) === true ? "SUBMITTED" : "PENDING")
        : null;
      if (result[order.id]) result[order.id].reviewStatus = reviewStatus;
      else result[order.id] = { userOrderNumber: null, userOrderTotal: null, reviewStatus };
    }
  }

  return result;
}
