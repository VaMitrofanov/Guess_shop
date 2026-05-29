import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";
import { notifyOrderCompleted, notifyOrderRejected } from "@/lib/twa-notify";

const VALID_STATUSES = ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "COMPLETED", "REJECTED"] as const;
type OrderStatus = typeof VALID_STATUSES[number];

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const status  = searchParams.get("status") as OrderStatus | "ALL" | null;
  const page    = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit   = Math.min(50, Math.max(5, parseInt(searchParams.get("limit") ?? "20", 10)));
  const skip    = (page - 1) * limit;
  const qRaw    = (searchParams.get("q") ?? "").trim();
  // Treat very short queries as no-op so we don't return half-the-table by accident
  const q       = qRaw.length >= 2 ? qRaw : "";

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
    Promise.all(
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

  // Enrich VK users whose stored name/username is generic or missing.
  // Now persists results back to the User row so subsequent requests skip the API call.
  const vkEnrichOrders = orders.filter((o: any) =>
    o.user?.vkId && (!o.user.name || o.user.name === "VK User" || !o.user.username)
  );
  if (vkEnrichOrders.length > 0 && process.env.VK_TOKEN) {
    const vkIds = [...new Set<string>(vkEnrichOrders.map((o: any) => String(o.user.vkId)))];
    try {
      const params = new URLSearchParams({
        user_ids:     vkIds.join(","),
        fields:       "first_name,last_name,screen_name",
        access_token: process.env.VK_TOKEN,
        v:            "5.131",
      });
      const vkRes  = await fetch("https://api.vk.com/method/users.get", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:   params.toString(),
      });
      const vkJson = (await vkRes.json()) as any;
      const map = new Map<string, { name: string; username?: string }>();
      for (const u of (vkJson?.response ?? [])) {
        if (!u?.id || !u?.first_name) continue;
        const fullName = [u.first_name, u.last_name].filter(Boolean).join(" ");
        const username = u.screen_name && u.screen_name !== `id${u.id}` ? String(u.screen_name) : undefined;
        map.set(String(u.id), { name: fullName, username });
      }
      // Update the in-memory orders and persist to DB (best-effort).
      const userIdsToPersist = new Set<string>();
      for (const order of orders) {
        const v = order.user?.vkId ? map.get(String(order.user.vkId)) : null;
        if (!v) continue;
        order.user = { ...order.user, name: v.name, username: v.username ?? order.user.username ?? null };
        userIdsToPersist.add(order.userId);
      }
      if (userIdsToPersist.size > 0) {
        await Promise.all([...userIdsToPersist].map(async (uid: string) => {
          const order = orders.find((o: any) => o.userId === uid);
          if (!order?.user?.vkId) return;
          const v = map.get(String(order.user.vkId));
          if (!v) return;
          try {
            await (prisma as any).user.update({
              where: { id: uid },
              data: {
                name: v.name,
                ...(v.username ? { username: v.username } : {}),
              },
            });
          } catch { /* race / drift — ignore */ }
        }));
      }
    } catch { /* non-fatal — keep stored names */ }
  }

  // ── Sequential order number within an identity cluster ───────────────────
  // Identity cluster = union of {tgId, vkId, robloxUsername}. We count how many
  // orders in the same cluster were created up to and including this one. The
  // same human ordering through TG and VK with the same Roblox nickname is
  // collapsed into one ledger — that's the manager's mental model.
  await Promise.all(orders.map(async (order: any) => {
    const orClauses: any[] = [];
    if (order.user?.tgId)   orClauses.push({ user: { tgId: order.user.tgId } });
    if (order.user?.vkId)   orClauses.push({ user: { vkId: order.user.vkId } });
    if (order.robloxUsername) orClauses.push({ robloxUsername: order.robloxUsername });
    if (orClauses.length === 0) {
      order.userOrderNumber = 1;
      order.userOrderTotal  = 1;
      return;
    }
    const [earlier, total] = await Promise.all([
      (prisma as any).wbOrder.count({
        where: { AND: [{ OR: orClauses }, { createdAt: { lt: order.createdAt } }] },
      }),
      (prisma as any).wbOrder.count({ where: { OR: orClauses } }),
    ]);
    order.userOrderNumber = earlier + 1;
    order.userOrderTotal  = total;
  }));

  // Attach reviewStatus for COMPLETED WB orders (non-direct only, first order per user gets review)
  const completedWbOrders = orders.filter((o: any) => o.status === "COMPLETED" && !o.isDirectOrder);
  if (completedWbOrders.length > 0) {
    const wbCodeValues = completedWbOrders.map((o: any) => o.wbCode as string);
    const codeRecords = await (prisma as any).wbCode.findMany({
      where: { code: { in: wbCodeValues } },
      select: { code: true, reviewBonusClaimed: true },
    });
    const reviewClaimedMap = new Map<string, boolean>(
      codeRecords.map((c: any) => [c.code as string, c.reviewBonusClaimed as boolean])
    );

    const uniqueUserIds = [...new Set<string>(completedWbOrders.map((o: any) => o.userId as string))];
    const firstOrderResults = await Promise.all(
      uniqueUserIds.map((uid: string) =>
        (prisma as any).wbOrder.findFirst({
          where: { userId: uid, status: "COMPLETED", isDirectOrder: false },
          orderBy: { createdAt: "asc" },
          select: { id: true, userId: true },
        })
      )
    );
    const firstOrderByUser = new Map<string, string>(
      firstOrderResults.filter(Boolean).map((o: any) => [o.userId as string, o.id as string])
    );

    for (const order of orders) {
      if (order.status === "COMPLETED" && !order.isDirectOrder) {
        const isFirstOrder = firstOrderByUser.get(order.userId) === order.id;
        order.reviewStatus = isFirstOrder
          ? (reviewClaimedMap.get(order.wbCode) === true ? "SUBMITTED" : "PENDING")
          : null;
      } else {
        order.reviewStatus = null;
      }
    }
  }

  return NextResponse.json({ orders, total, counts, page, pages: Math.ceil(total / limit) });
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
