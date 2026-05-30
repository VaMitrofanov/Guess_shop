import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";
import { notifyOrderCompleted, notifyOrderRejected } from "@/lib/twa-notify";

const VALID_STATUSES = ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "COMPLETED", "REJECTED"] as const;
type OrderStatus = typeof VALID_STATUSES[number];

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

  const statusWhere = (status && status !== "ALL" && VALID_STATUSES.includes(status as OrderStatus))
    ? { status: status as OrderStatus }
    : {};

  // Build a multi-field search that mirrors how managers describe orders verbally:
  // Roblox nickname, gamepass URL/ID, WB code, TG/VK display name or numeric ID, or
  // the short order-ID suffix shown in admin cards. Case-insensitive contains.
  let searchWhere: any = {};
  if (q) {
    const qDigits = q.replace(/\D/g, "");
    // Treat the query as "numeric ID" only when it's actually a numeric string
    // (≥4 digits AND ≥80 % digits). Otherwise a WB code like "4YNF7HH" leaks
    // its two stray digits "47" into tgId/vkId/URL `contains` and matches
    // arbitrary unrelated orders.
    const isNumericId = qDigits.length >= 4 && qDigits.length / q.length >= 0.8;
    const orClauses: any[] = [
      { gamepassUrl:    { contains: q,           mode: "insensitive" } },
      { robloxUsername: { contains: q,           mode: "insensitive" } },
      { wbCode:         { contains: q.toUpperCase() } },
      { id:             { endsWith: q.toLowerCase() } },
      { user: { name:   { contains: q,           mode: "insensitive" } } },
    ];
    if (isNumericId) {
      orClauses.push({ user: { tgId: { contains: qDigits } } });
      orClauses.push({ user: { vkId: { contains: qDigits } } });
      // Asset ID inside gamepassUrl (digits only is a common ask)
      orClauses.push({ gamepassUrl: { contains: qDigits } });
    }
    searchWhere = { OR: orClauses };
  }

  const where = q
    ? { AND: [statusWhere, searchWhere] }
    : statusWhere;

  const [orders, total, counts] = await Promise.all([
    (prisma as any).wbOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        user: { select: {
          tgId: true, vkId: true, name: true, username: true,
          balance: true, reviewBonusGrantedAt: true,
        } },
      },
    }),
    (prisma as any).wbOrder.count({ where }),
    skipCounts
      ? Promise.resolve(null)
      : Promise.all(
          [...VALID_STATUSES, "ALL"].map(async s => {
            const statusPart = s === "ALL" ? {} : { status: s };
            // When user is searching, chip counts reflect the search so they show
            // how many of *her* orders are PENDING / COMPLETED / etc.
            const w = q ? { AND: [statusPart, searchWhere] } : statusPart;
            const count = await (prisma as any).wbOrder.count({ where: w });
            return [s, count] as [string, number];
          })
        ).then(entries => Object.fromEntries(entries)),
  ]);

  // ── Sequential order number within an identity cluster ─────────────────────
  // Identity cluster = orders sharing any of {tgId, vkId, robloxUsername} with the
  // page order. Previously this fired 2 COUNT queries *per page order* = 40
  // round-trips. Now: one findMany over the union of all page identifiers, then
  // group/count in memory. Same behaviour, single DB query.
  const pageTgIds       = new Set<string>();
  const pageVkIds       = new Set<string>();
  const pageRobloxNicks = new Set<string>();
  for (const o of orders) {
    if (o.user?.tgId)       pageTgIds.add(String(o.user.tgId));
    if (o.user?.vkId)       pageVkIds.add(String(o.user.vkId));
    if (o.robloxUsername)   pageRobloxNicks.add(String(o.robloxUsername));
  }
  let clusterOrders: Array<{ createdAt: Date; robloxUsername: string | null; user: { tgId: string | null; vkId: string | null } | null }> = [];
  if (pageTgIds.size + pageVkIds.size + pageRobloxNicks.size > 0) {
    const orClauses: any[] = [];
    if (pageTgIds.size      > 0) orClauses.push({ user: { tgId: { in: [...pageTgIds] } } });
    if (pageVkIds.size      > 0) orClauses.push({ user: { vkId: { in: [...pageVkIds] } } });
    if (pageRobloxNicks.size > 0) orClauses.push({ robloxUsername: { in: [...pageRobloxNicks] } });
    clusterOrders = await (prisma as any).wbOrder.findMany({
      where: { OR: orClauses },
      select: {
        createdAt:      true,
        robloxUsername: true,
        user:           { select: { tgId: true, vkId: true } },
      },
    });
  }
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
    let total = 0, earlier = 0;
    for (const c of clusterOrders) {
      const match =
        (myTg     && c.user?.tgId === myTg) ||
        (myVk     && c.user?.vkId === myVk) ||
        (myRoblox && c.robloxUsername === myRoblox);
      if (!match) continue;
      total++;
      if (new Date(c.createdAt).getTime() < myCreated) earlier++;
    }
    order.userOrderNumber = earlier + 1;
    order.userOrderTotal  = total;
  }

  // ── reviewStatus for COMPLETED WB orders (non-direct only, first order/user) ─
  // Was N findFirst calls. Now: one groupBy with _min(createdAt) per user.
  const completedWbOrders = orders.filter((o: any) => o.status === "COMPLETED" && !o.isDirectOrder);
  if (completedWbOrders.length > 0) {
    const wbCodeValues = completedWbOrders.map((o: any) => o.wbCode as string);
    const uniqueUserIds = [...new Set<string>(completedWbOrders.map((o: any) => o.userId as string))];

    const [codeRecords, firstOrderRows] = await Promise.all([
      (prisma as any).wbCode.findMany({
        where: { code: { in: wbCodeValues } },
        select: { code: true, reviewBonusClaimed: true },
      }),
      (prisma as any).wbOrder.groupBy({
        by: ["userId"],
        where: { userId: { in: uniqueUserIds }, status: "COMPLETED", isDirectOrder: false },
        _min: { createdAt: true },
      }),
    ]);

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

  // VK enrich — fire-and-forget. The first request returns un-enriched names
  // (UI falls back to "TG · <id>" / "VK · <id>"); subsequent requests pick up
  // the persisted enrichment from the DB. Used to block the response by 300-800 ms.
  const vkEnrichOrders = orders.filter((o: any) =>
    o.user?.vkId && (!o.user.name || o.user.name === "VK User" || !o.user.username)
  );
  if (vkEnrichOrders.length > 0 && process.env.VK_TOKEN) {
    void enrichVkUsers(vkEnrichOrders);
  }

  return NextResponse.json({ orders, total, counts, page, pages: Math.ceil(total / limit) });
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
    return NextResponse.json({ ok: true });
  }

  if (action === "complete") {
    if (!["PENDING", "IN_PROGRESS"].includes(order.status))
      return NextResponse.json({ error: "Order must be PENDING or IN_PROGRESS" }, { status: 400 });
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data:  { status: "COMPLETED" },
    });
    notifyOrderCompleted(order.user, orderId, order.amount, order.isDirectOrder).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (action === "reject") {
    if (!["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS"].includes(order.status))
      return NextResponse.json({ error: "Cannot reject this order" }, { status: 400 });
    const rejectionReason = String(reason ?? "не указана");
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data:  { status: "REJECTED", rejectionReason },
    });
    notifyOrderRejected(order.user, orderId, rejectionReason, order.amount).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
