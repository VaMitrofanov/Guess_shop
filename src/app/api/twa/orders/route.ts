import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";
import { notifyOrderCompleted, notifyOrderRejected } from "@/lib/twa-notify";

const VALID_STATUSES = ["AWAITING_PAYMENT", "PAYMENT_PENDING", "AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "COMPLETED", "REJECTED"] as const;
type OrderStatus = typeof VALID_STATUSES[number];

let cachedCounts: { data: Record<string, number>; sums: Record<string, number>; ts: number } | null = null;
const COUNT_CACHE_TTL = 30_000;

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const status      = searchParams.get("status") as OrderStatus | "ALL" | null;
  const page        = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit       = Math.min(50, Math.max(5, parseInt(searchParams.get("limit") ?? "20", 10)));
  const skip        = (page - 1) * limit;
  const qRaw        = (searchParams.get("q") ?? "").trim();
  // Treat very short queries as no-op so we don't return half-the-table by accident
  const q           = qRaw.length >= 2 ? qRaw : "";
  // Page 2+ (load-more) re-uses the prior page's counts so we save 6 COUNTs per request.
  const skipCounts  = searchParams.get("skipCounts") === "1";
  const lite        = searchParams.get("lite") === "1";

  const statusWhere = (status && status !== "ALL" && VALID_STATUSES.includes(status as OrderStatus))
    ? { status: status as OrderStatus }
    : {};

  // Build a multi-field search that mirrors how managers describe orders verbally:
  // Roblox nickname, gamepass URL/ID, WB code, TG/VK display name or numeric ID, or
  // the short order-ID suffix shown in admin cards. Case-insensitive contains.
  let searchWhere: any = {};
  if (q) {
    const qClean = q.replace(/^@/, "");
    const qDigits = q.replace(/\D/g, "");
    // Treat the query as "numeric ID" only when it's actually a numeric string
    // (≥4 digits AND ≥80 % digits). Otherwise a WB code like "4YNF7HH" leaks
    // its two stray digits "47" into tgId/vkId/URL `contains` and matches
    // arbitrary unrelated orders.
    const isNumericId = qDigits.length >= 4 && qDigits.length / q.length >= 0.8;
    const orClauses: any[] = [
      { gamepassUrl:    { contains: q,           mode: "insensitive" } },
      { robloxUsername: { contains: qClean,      mode: "insensitive" } },
      { wbCode:         { contains: q.toUpperCase() } },
      { id:             { endsWith: q.toLowerCase() } },
      { user: { name:     { contains: q,         mode: "insensitive" } } },
      { user: { username: { contains: qClean,    mode: "insensitive" } } },
    ];
    if (isNumericId) {
      orClauses.push({ user: { tgId: { contains: qDigits } } });
      orClauses.push({ user: { vkId: { contains: qDigits } } });
      orClauses.push({ gamepassUrl: { contains: qDigits } });
    }
    searchWhere = { OR: orClauses };
  }

  const where = q
    ? { AND: [statusWhere, searchWhere] }
    : statusWhere;

  // ── Phase 1: orders + combined counts in ONE parallel batch ──────────────
  // Previous: 1 findMany + 1 COUNT(total) + 6 COUNT(per status) = 8 queries
  // through a max:1 pool → all sequential. Now: 2 queries in true parallel.
  const take = skipCounts ? limit + 1 : limit;
  const ordersPromise = (prisma as any).wbOrder.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip,
    take,
    include: {
      user: { select: {
        tgId: true, vkId: true, name: true, username: true,
        balance: true, reviewBonusGrantedAt: true,
      } },
    },
  });

  const countsPromise = skipCounts
    ? Promise.resolve({ total: 0, counts: null as Record<string, number> | null, sums: null as Record<string, number> | null })
    : (async () => {
        if (!q) {
          if (cachedCounts && Date.now() - cachedCounts.ts < COUNT_CACHE_TTL) {
            const { data: counts, sums } = cachedCounts;
            const total = (status && status !== "ALL") ? (counts[status] ?? 0) : counts["ALL"];
            return { total, counts, sums };
          }
          const rows: any[] = await (prisma as any).$queryRawUnsafe(`
            SELECT
              COUNT(*)::int AS "ALL",
              COUNT(*) FILTER (WHERE status = 'AWAITING_PAYMENT')::int AS "AWAITING_PAYMENT",
              COUNT(*) FILTER (WHERE status = 'PAYMENT_PENDING')::int AS "PAYMENT_PENDING",
              COUNT(*) FILTER (WHERE status = 'AWAITING_GAMEPASS')::int AS "AWAITING_GAMEPASS",
              COUNT(*) FILTER (WHERE status = 'PENDING')::int AS "PENDING",
              COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS "IN_PROGRESS",
              COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS "COMPLETED",
              COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS "REJECTED",
              COALESCE(SUM(amount) FILTER (WHERE status = 'AWAITING_PAYMENT'),  0)::int AS "SUM_AWAITING_PAYMENT",
              COALESCE(SUM(amount) FILTER (WHERE status = 'PAYMENT_PENDING'),   0)::int AS "SUM_PAYMENT_PENDING",
              COALESCE(SUM(amount) FILTER (WHERE status = 'AWAITING_GAMEPASS'), 0)::int AS "SUM_AWAITING_GAMEPASS",
              COALESCE(SUM(amount) FILTER (WHERE status = 'PENDING'),           0)::int AS "SUM_PENDING",
              COALESCE(SUM(amount) FILTER (WHERE status = 'IN_PROGRESS'),       0)::int AS "SUM_IN_PROGRESS",
              COALESCE(SUM(amount) FILTER (WHERE status = 'COMPLETED'),         0)::int AS "SUM_COMPLETED",
              COALESCE(SUM(amount) FILTER (WHERE status = 'REJECTED'),          0)::int AS "SUM_REJECTED"
            FROM "WbOrder"
          `);
          const r = rows[0] ?? {};
          const counts: Record<string, number> = {};
          const sums: Record<string, number> = {};
          for (const s of [...VALID_STATUSES, "ALL"]) counts[s] = Number(r[s] ?? 0);
          for (const s of VALID_STATUSES) sums[s] = Number(r[`SUM_${s}`] ?? 0);
          cachedCounts = { data: counts, sums, ts: Date.now() };
          const total = (status && status !== "ALL") ? (counts[status] ?? 0) : counts["ALL"];
          return { total, counts, sums };
        }
        const groups: any[] = await (prisma as any).wbOrder.groupBy({
          by: ["status"],
          where: searchWhere,
          _count: { _all: true },
          _sum: { amount: true },
        });
        const counts: Record<string, number> = {};
        const sums: Record<string, number> = {};
        for (const s of [...VALID_STATUSES, "ALL"]) counts[s] = 0;
        for (const s of VALID_STATUSES) sums[s] = 0;
        for (const g of groups) {
          const cnt = typeof g._count === "number" ? g._count : g._count?._all ?? 0;
          counts[g.status] = cnt;
          counts["ALL"] += cnt;
          sums[g.status] = Number(g._sum?.amount ?? 0);
        }
        const total = (status && status !== "ALL") ? (counts[status] ?? 0) : counts["ALL"];
        return { total, counts, sums };
      })();

  const [rawOrders, { total, counts, sums }] = await Promise.all([ordersPromise, countsPromise]);
  const hasMore = skipCounts && rawOrders.length > limit;
  const orders = hasMore ? rawOrders.slice(0, limit) : rawOrders;
  const finalTotal = skipCounts
    ? skip + orders.length + (hasMore ? limit : 0)
    : total;

  // ── Enrichment: cluster numbering + review status (skipped in lite mode) ────
  if (!lite) {
    const pageTgIds       = new Set<string>();
    const pageVkIds       = new Set<string>();
    const pageRobloxNicks = new Set<string>();
    for (const o of orders) {
      if (o.user?.tgId)       pageTgIds.add(String(o.user.tgId));
      if (o.user?.vkId)       pageVkIds.add(String(o.user.vkId));
      if (o.robloxUsername)   pageRobloxNicks.add(String(o.robloxUsername));
    }
    const clusterOrClauses: any[] = [];
    if (pageTgIds.size      > 0) clusterOrClauses.push({ user: { tgId: { in: [...pageTgIds] } } });
    if (pageVkIds.size      > 0) clusterOrClauses.push({ user: { vkId: { in: [...pageVkIds] } } });
    if (pageRobloxNicks.size > 0) clusterOrClauses.push({ robloxUsername: { in: [...pageRobloxNicks] } });

    const completedWbOrders = orders.filter((o: any) => o.status === "COMPLETED" && !o.isDirectOrder);
    const wbCodeValues     = completedWbOrders.map((o: any) => o.wbCode as string);
    const uniqueUserIds    = [...new Set<string>(completedWbOrders.map((o: any) => o.userId as string))];

    const [clusterOrders, codeRecords, firstOrderRows] = await Promise.all([
      clusterOrClauses.length > 0
        ? (prisma as any).wbOrder.findMany({
            where: { OR: clusterOrClauses },
            select: { createdAt: true, robloxUsername: true, user: { select: { tgId: true, vkId: true } } },
          })
        : [],
      completedWbOrders.length > 0
        ? (prisma as any).wbCode.findMany({
            where: { code: { in: wbCodeValues } },
            select: { code: true, reviewBonusClaimed: true },
          })
        : [],
      completedWbOrders.length > 0
        ? (prisma as any).wbOrder.groupBy({
            by: ["userId"],
            where: { userId: { in: uniqueUserIds }, status: "COMPLETED", isDirectOrder: false },
            _min: { createdAt: true },
          })
        : [],
    ]);

    for (const order of orders) {
      const myTg     = order.user?.tgId     ?? null;
      const myVk     = order.user?.vkId     ?? null;
      const myRoblox = order.robloxUsername ?? null;
      if (!myTg && !myVk && !myRoblox) {
        order.userOrderNumber = 1;
        order.userOrderTotal  = 1;
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
      order.userOrderNumber = earlier + 1;
      order.userOrderTotal  = cnt;
    }

    if (completedWbOrders.length > 0) {
      const reviewClaimedMap = new Map<string, boolean>(
        codeRecords.map((c: any) => [c.code as string, c.reviewBonusClaimed as boolean])
      );
      const firstCreatedByUser = new Map<string, number>(
        firstOrderRows
          .filter((r: any) => r._min?.createdAt)
          .map((r: any) => [r.userId as string, new Date(r._min.createdAt).getTime()])
      );
      for (const order of orders) {
        if (order.status === "COMPLETED" && !order.isDirectOrder) {
          const firstAt = firstCreatedByUser.get(order.userId);
          const isFirstOrder = firstAt !== undefined && new Date(order.createdAt).getTime() === firstAt;
          order.reviewStatus = isFirstOrder
            ? (reviewClaimedMap.get(order.wbCode) === true ? "SUBMITTED" : "PENDING")
            : null;
        } else {
          order.reviewStatus = null;
        }
      }
    }

  }

  const vkEnrichOrders = orders.filter((o: any) =>
    o.user?.vkId && (!o.user.name || o.user.name === "VK User" || !o.user.username)
  );
  if (vkEnrichOrders.length > 0 && process.env.VK_TOKEN) {
    void enrichVkUsers(vkEnrichOrders);
  }

  return NextResponse.json({ orders, total: finalTotal, counts, sums, page, pages: Math.ceil(finalTotal / limit) });
}

/**
 * Persist VK first/last name + screen_name into User rows whose entry is generic
 * ("VK User") or missing. Runs in the background after the response is sent.
 * The current request's response is *not* enriched — that's the trade-off for
 * not blocking the client by an external API roundtrip + N user-row UPDATEs.
 */
async function enrichVkUsers(orders: any[]) {
  try {
    const vkIds = [...new Set<string>(orders.map((o: any) => String(o.user.vkId)))];
    const params = new URLSearchParams({
      user_ids:     vkIds.join(","),
      fields:       "first_name,last_name,screen_name",
      access_token: process.env.VK_TOKEN!,
      v:            "5.131",
    });
    const vkRes = await fetch("https://api.vk.com/method/users.get", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    params.toString(),
    });
    const vkJson = (await vkRes.json()) as any;
    const map = new Map<string, { name: string; username?: string }>();
    for (const u of (vkJson?.response ?? [])) {
      if (!u?.id || !u?.first_name) continue;
      const fullName = [u.first_name, u.last_name].filter(Boolean).join(" ");
      const username = u.screen_name && u.screen_name !== `id${u.id}` ? String(u.screen_name) : undefined;
      map.set(String(u.id), { name: fullName, username });
    }
    const userIdsToPersist = new Set<string>();
    for (const o of orders) {
      const v = o.user?.vkId ? map.get(String(o.user.vkId)) : null;
      if (!v) continue;
      userIdsToPersist.add(o.userId);
    }
    await Promise.allSettled([...userIdsToPersist].map(async (uid: string) => {
      const order = orders.find((o: any) => o.userId === uid);
      if (!order?.user?.vkId) return;
      const v = map.get(String(order.user.vkId));
      if (!v) return;
      await (prisma as any).user.update({
        where: { id: uid },
        data: {
          name: v.name,
          ...(v.username ? { username: v.username } : {}),
        },
      });
    }));
  } catch { /* non-fatal — stays generic, retried on next request */ }
}

export async function POST(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.action || !body?.orderId)
    return NextResponse.json({ error: "action and orderId required" }, { status: 400 });

  const { action, orderId, reason } = body;

  const order = await (prisma as any).wbOrder.findUnique({
    where: { id: orderId },
    include: { user: { select: { id: true, tgId: true, vkId: true } } },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  if (action === "take-work") {
    if (order.status !== "PENDING")
      return NextResponse.json({ error: "Order must be PENDING" }, { status: 400 });
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data:  { status: "IN_PROGRESS" },
    });
    cachedCounts = null;
    return NextResponse.json({ ok: true });
  }

  if (action === "complete") {
    if (!["PENDING", "IN_PROGRESS"].includes(order.status))
      return NextResponse.json({ error: "Order must be PENDING or IN_PROGRESS" }, { status: 400 });
    const settings = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
    const currentRate = settings?.purchaseRate ?? null;
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data:  { status: "COMPLETED", purchaseRate: currentRate },
    });
    cachedCounts = null;
    notifyOrderCompleted(order.user, orderId, order.amount, order.isDirectOrder).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (action === "reject") {
    if (!["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS", "AWAITING_PAYMENT", "PAYMENT_PENDING"].includes(order.status))
      return NextResponse.json({ error: "Cannot reject this order" }, { status: 400 });
    const rejectionReason = String(reason ?? "не указана");
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data:  { status: "REJECTED", rejectionReason },
    });
    cachedCounts = null;
    notifyOrderRejected(order.user, orderId, rejectionReason, order.amount).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
