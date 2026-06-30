import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";
import { notifyOrderCompleted, notifyOrderRejected } from "@/lib/twa-notify";

const VALID_STATUSES = ["AWAITING_PAYMENT", "PAYMENT_PENDING", "AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "COMPLETED", "REJECTED", "ERROR"] as const;
type OrderStatus = typeof VALID_STATUSES[number];
type FilterTab = "ALL" | "BUYOUT" | "DIRECT" | "NEW" | "ERROR" | "AWAITING_LINK" | "FAVORITES";

const NEW_CUTOFF_HOURS = 40;

let cachedCounts: { data: Record<string, number>; sums: Record<string, number>; ts: number } | null = null;
const COUNT_CACHE_TTL = 30_000;

function buildTabWhere(tab: FilterTab): any {
  const cutoff = new Date(Date.now() - NEW_CUTOFF_HOURS * 3600_000);
  switch (tab) {
    case "ALL":
      return {};
    case "BUYOUT":
      return { status: { in: ["PENDING", "IN_PROGRESS"] }, isDirectOrder: false, isFavorite: false };
    case "DIRECT":
      return { isDirectOrder: true, status: { in: ["PENDING", "IN_PROGRESS", "AWAITING_PAYMENT", "PAYMENT_PENDING", "ERROR"] }, isFavorite: false };
    case "NEW":
      return { status: "AWAITING_GAMEPASS", createdAt: { gt: cutoff }, isFavorite: false };
    case "ERROR":
      return { status: "ERROR", isFavorite: false };
    case "AWAITING_LINK":
      return { status: "AWAITING_GAMEPASS", createdAt: { lte: cutoff }, isFavorite: false };
    case "FAVORITES":
      return { isFavorite: true };
    default:
      return {};
  }
}

function sortForTab(tab: FilterTab): "asc" | "desc" {
  if (tab === "BUYOUT" || tab === "DIRECT" || tab === "ERROR" || tab === "AWAITING_LINK") return "asc";
  return "desc";
}

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const tab         = (searchParams.get("status") ?? "ALL") as FilterTab | OrderStatus;
  const page        = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit       = Math.min(50, Math.max(5, parseInt(searchParams.get("limit") ?? "20", 10)));
  const skip        = (page - 1) * limit;
  const qRaw        = (searchParams.get("q") ?? "").trim();
  const q           = qRaw.length >= 2 ? qRaw : "";
  const skipCounts  = searchParams.get("skipCounts") === "1";
  const lite        = searchParams.get("lite") === "1";

  const isVirtualTab = ["ALL", "BUYOUT", "DIRECT", "NEW", "ERROR", "AWAITING_LINK", "FAVORITES"].includes(tab);
  const tabWhere = isVirtualTab
    ? buildTabWhere(tab as FilterTab)
    : (VALID_STATUSES.includes(tab as any) ? { status: tab } : {});
  const sortDir = isVirtualTab ? sortForTab(tab as FilterTab) : "desc";

  let searchWhere: any = {};
  if (q) {
    const qClean = q.replace(/^@/, "");
    const qDigits = q.replace(/\D/g, "");
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

  const notTest = { isTest: false };
  const where = q
    ? { AND: [notTest, tabWhere, searchWhere] }
    : { ...notTest, ...tabWhere };

  const take = skipCounts ? limit + 1 : limit;
  const ordersPromise = (prisma as any).wbOrder.findMany({
    where,
    orderBy: { createdAt: sortDir },
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
            return { total: tabTotal(tab, cachedCounts.data), counts: cachedCounts.data, sums: cachedCounts.sums };
          }
          const rows: any[] = await (prisma as any).$queryRawUnsafe(`
            SELECT
              COUNT(*)::int AS "ALL",
              COUNT(*) FILTER (WHERE status IN ('PENDING','IN_PROGRESS') AND "isDirectOrder" = false AND "isFavorite" = false)::int AS "BUYOUT",
              COUNT(*) FILTER (WHERE "isDirectOrder" = true AND status IN ('PENDING','IN_PROGRESS','AWAITING_PAYMENT','PAYMENT_PENDING','ERROR') AND "isFavorite" = false)::int AS "DIRECT",
              COUNT(*) FILTER (WHERE status = 'AWAITING_GAMEPASS' AND "createdAt" > NOW() - INTERVAL '${NEW_CUTOFF_HOURS} hours' AND "isFavorite" = false)::int AS "NEW",
              COUNT(*) FILTER (WHERE status = 'ERROR' AND "isFavorite" = false)::int AS "ERROR",
              COUNT(*) FILTER (WHERE status = 'AWAITING_GAMEPASS' AND "createdAt" <= NOW() - INTERVAL '${NEW_CUTOFF_HOURS} hours' AND "isFavorite" = false)::int AS "AWAITING_LINK",
              COUNT(*) FILTER (WHERE "isFavorite" = true)::int AS "FAVORITES",
              COALESCE(SUM(amount) FILTER (WHERE status IN ('PENDING','IN_PROGRESS') AND "isDirectOrder" = false AND "isFavorite" = false), 0)::int AS "SUM_BUYOUT",
              COALESCE(SUM(amount) FILTER (WHERE "isDirectOrder" = true AND status IN ('PENDING','IN_PROGRESS','AWAITING_PAYMENT','PAYMENT_PENDING','ERROR') AND "isFavorite" = false), 0)::int AS "SUM_DIRECT",
              COALESCE(SUM(amount) FILTER (WHERE status = 'AWAITING_GAMEPASS' AND "isFavorite" = false), 0)::int AS "SUM_AWAITING_LINK"
            FROM "WbOrder"
            WHERE "isTest" = false
          `);
          const r = rows[0] ?? {};
          const counts: Record<string, number> = {};
          const sums: Record<string, number> = {};
          for (const k of ["ALL", "BUYOUT", "DIRECT", "NEW", "ERROR", "AWAITING_LINK", "FAVORITES"] as const)
            counts[k] = Number(r[k] ?? 0);
          sums["BUYOUT"] = Number(r["SUM_BUYOUT"] ?? 0);
          sums["DIRECT"] = Number(r["SUM_DIRECT"] ?? 0);
          sums["AWAITING_LINK"] = Number(r["SUM_AWAITING_LINK"] ?? 0);
          cachedCounts = { data: counts, sums, ts: Date.now() };
          return { total: tabTotal(tab, counts), counts, sums };
        }
        const cnt = await (prisma as any).wbOrder.count({ where });
        return { total: cnt, counts: null, sums: null };
      })();

  const [rawOrders, { total, counts, sums }] = await Promise.all([ordersPromise, countsPromise]);
  const hasMore = skipCounts && rawOrders.length > limit;
  const orders = hasMore ? rawOrders.slice(0, limit) : rawOrders;
  const finalTotal = skipCounts
    ? skip + orders.length + (hasMore ? limit : 0)
    : total;

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

function tabTotal(tab: string, counts: Record<string, number>): number {
  return counts[tab] ?? counts["ALL"] ?? 0;
}

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
  } catch { /* non-fatal */ }
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

  if (action === "set-note") {
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data:  { adminNote: note || null },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "toggle-favorite") {
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data:  { isFavorite: !order.isFavorite },
    });
    cachedCounts = null;
    return NextResponse.json({ ok: true, isFavorite: !order.isFavorite });
  }

  if (action === "set-error") {
    if (!["PENDING", "IN_PROGRESS", "ERROR"].includes(order.status))
      return NextResponse.json({ error: "Cannot set error on this order" }, { status: 400 });
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data:  { status: "ERROR" },
    });
    cachedCounts = null;
    return NextResponse.json({ ok: true });
  }

  if (action === "move-to") {
    const target = body.target as string;
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note) return NextResponse.json({ error: "Заметка обязательна при переводе" }, { status: 400 });

    const statusMap: Record<string, string> = {
      BUYOUT: "PENDING",
      DIRECT: "PENDING",
      NEW: "AWAITING_GAMEPASS",
      ERROR: "ERROR",
      AWAITING_LINK: "AWAITING_GAMEPASS",
    };
    const newStatus = statusMap[target];
    if (!newStatus) return NextResponse.json({ error: "Invalid target" }, { status: 400 });

    const data: any = {
      status: newStatus,
      adminNote: note.slice(0, 2000),
      isFavorite: false,
    };
    if (target === "DIRECT") data.isDirectOrder = true;
    if (target === "BUYOUT") data.isDirectOrder = false;

    await (prisma as any).wbOrder.update({ where: { id: orderId }, data });
    cachedCounts = null;
    return NextResponse.json({ ok: true });
  }

  if (action === "complete") {
    if (!["PENDING", "IN_PROGRESS", "ERROR"].includes(order.status))
      return NextResponse.json({ error: "Order must be PENDING, IN_PROGRESS or ERROR" }, { status: 400 });
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
    if (!["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS", "AWAITING_PAYMENT", "PAYMENT_PENDING", "ERROR"].includes(order.status))
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

  if (action === "purchase") {
    if (!["PENDING", "IN_PROGRESS", "ERROR"].includes(order.status))
      return NextResponse.json({ error: "Order must be PENDING, IN_PROGRESS or ERROR" }, { status: 400 });

    const gpMatch = order.gamepassUrl?.match(/game-pass(?:es)?\/(\d+)/);
    if (!gpMatch) return NextResponse.json({ error: "No gamepass URL" }, { status: 400 });
    const gpId = gpMatch[1];

    const settings = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
    const cookie = settings?.robloxCookie;
    if (!cookie) return NextResponse.json({ error: "Cookie не задан. /setcookie в боте" }, { status: 400 });

    const infoUrls = [
      `https://apis.roblox.com/game-passes/v1/game-passes/${gpId}/product-info`,
      `https://apis.roproxy.com/game-passes/v1/game-passes/${gpId}/product-info`,
    ];
    let info: any = null;
    for (const url of infoUrls) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (r.ok) { info = await r.json(); break; }
      } catch { /* try next */ }
    }
    if (!info?.ProductId)
      return NextResponse.json({ error: "Не удалось получить product-info" }, { status: 502 });

    if (!info.IsForSale)
      return NextResponse.json({ error: "Геймпасс не на продаже" }, { status: 400 });

    const price = info.PriceInRobux ?? 0;
    const base = info.UserBasePriceInRobux ?? price;
    const isManagedPricing = price !== base;
    const creatorId = info.Creator?.Id ?? info.Creator?.CreatorTargetId ?? 0;

    const csrfRes = await fetch("https://auth.roblox.com/v2/logout", {
      method: "POST",
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    let csrf = csrfRes?.headers.get("x-csrf-token");
    if (!csrf)
      return NextResponse.json({ error: "Не удалось получить CSRF — cookie протух?" }, { status: 502 });

    let purchaseRes: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      purchaseRes = await fetch(
        `https://economy.roblox.com/v1/purchases/products/${info.ProductId}`,
        {
          method: "POST",
          headers: {
            Cookie: `.ROBLOSECURITY=${cookie}`,
            "Content-Type": "application/json",
            "x-csrf-token": csrf,
          },
          body: JSON.stringify({
            expectedCurrency: 1,
            expectedPrice: price,
            expectedSellerId: creatorId,
          }),
          signal: AbortSignal.timeout(15000),
        },
      ).catch(() => null);

      if (purchaseRes?.status === 403) {
        const newCsrf = purchaseRes.headers.get("x-csrf-token");
        if (newCsrf && attempt === 0) { csrf = newCsrf; continue; }
      }
      break;
    }

    if (purchaseRes?.status === 401)
      return NextResponse.json({ ok: true, success: false, msg: "Cookie истёк — обнови через /setcookie" });

    const purchaseData: any = await purchaseRes?.json().catch(() => null);

    if (!purchaseData)
      return NextResponse.json({ error: "Нет ответа от Roblox" }, { status: 502 });

    if (purchaseData.purchased) {
      const currentRate = settings?.purchaseRate ?? null;
      await (prisma as any).wbOrder.updateMany({
        where: { id: orderId, status: { in: ["PENDING", "IN_PROGRESS", "ERROR"] } },
        data: { status: "COMPLETED", purchaseRate: currentRate },
      });
      cachedCounts = null;
      notifyOrderCompleted(order.user, orderId, order.amount, order.isDirectOrder ?? false).catch(() => {});
      const mpWarn = isManagedPricing ? ` (MP: ${price}/${base})` : "";
      return NextResponse.json({ ok: true, success: true, msg: `Куплено за ${purchaseData.price ?? price} R$${mpWarn}` });
    }

    await (prisma as any).wbOrder.updateMany({
      where: { id: orderId, status: { in: ["PENDING", "IN_PROGRESS"] } },
      data: { status: "ERROR" },
    });
    cachedCounts = null;

    const failReason = purchaseData.reason ?? purchaseData.errorMsg ?? "Неизвестная ошибка";
    return NextResponse.json({ ok: true, success: false, msg: failReason });
  }

  if (action === "purchase-script") {
    const gpMatch = order.gamepassUrl?.match(/game-pass(?:es)?\/(\d+)/);
    if (!gpMatch) return NextResponse.json({ error: "No gamepass URL" }, { status: 400 });
    const gpId = gpMatch[1];

    const urls = [
      `https://apis.roblox.com/game-passes/v1/game-passes/${gpId}/product-info`,
      `https://apis.roproxy.com/game-passes/v1/game-passes/${gpId}/product-info`,
    ];
    let info: any = null;
    for (const url of urls) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (r.ok) { info = await r.json(); break; }
      } catch { /* try next */ }
    }
    if (!info?.ProductId)
      return NextResponse.json({ error: "Failed to fetch product info" }, { status: 502 });

    const price = info.PriceInRobux ?? 0;
    const base = info.UserBasePriceInRobux ?? price;
    const isManagedPricing = price !== base;
    const isForSale = info.IsForSale ?? false;
    const creatorId = info.Creator?.Id ?? info.Creator?.CreatorTargetId ?? 0;
    const creatorName = info.Creator?.Name ?? "Unknown";
    const name = info.Name ?? "Gamepass";

    const script = [
      `(async()=>{`,
      `const r=await fetch("https://auth.roblox.com/v2/logout",{method:"POST",credentials:"include"});`,
      `const t=r.headers.get("x-csrf-token");`,
      `if(!t){console.log("❌ Не залогинен");return}`,
      `const b=await fetch("https://economy.roblox.com/v1/purchases/products/${info.ProductId}",{`,
      `method:"POST",credentials:"include",`,
      `headers:{"Content-Type":"application/json","X-CSRF-TOKEN":t},`,
      `body:JSON.stringify({expectedCurrency:1,expectedPrice:${price},expectedSellerId:${creatorId}})`,
      `});const j=await b.json();`,
      `console.log(j.purchased?"✅ Куплено: "+j.price+" R$":"❌ Ошибка: "+j.reason)`,
      `})()`,
    ].join("");

    return NextResponse.json({
      ok: true, script, name, price, base, creatorName,
      isForSale, isManagedPricing, gamepassId: gpId,
    });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
