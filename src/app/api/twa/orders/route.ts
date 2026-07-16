import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";
import { notifyOrderCompleted, notifyOrderRejected, notifyRebind, notifyGamepassAttached, notifyGpWatchPing, notifyRegionalPriceNeeded } from "@/lib/twa-notify";
import { searchForSalePassesByNick } from "@/lib/roblox-gamepass-search";
import { BuyoutError, getAuthenticatedUserId, isLegacyPurchaseFlowFailure, needsOwnershipCheck, resolveGamepassForBuyer, verifyGamepassOwnership, verifyOwnershipAfterFailure, type ResolvedGamepass } from "@/lib/roblox-buyout";
import { buildGamepassPurchaseScript, gamepassPageUrl } from "@/lib/roblox-purchase-script";
import { BUYOUT_ERROR_LEGACY_PURCHASE_FLOW, BUYOUT_ERROR_REGIONAL_PRICE, BUYOUT_ERROR_ROBLOX_PLUS_FLOW, checkGamepassPrice, sellerMatchesOrder } from "@/lib/purchase-guard";
import { buildOrderProfitSnapshot } from "@/lib/order-profit";
import { appendOrderAudit, buildRestoreToBuyoutData } from "@/lib/order-recovery";

const VALID_STATUSES = ["AWAITING_PAYMENT", "PAYMENT_PENDING", "AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "COMPLETED", "REJECTED", "ERROR"] as const;
type OrderStatus = typeof VALID_STATUSES[number];
type FilterTab = "WORK" | "ALL" | "BUYOUT" | "DIRECT" | "AVITO" | "NEW" | "ERROR" | "AWAITING_LINK" | "DONE" | "FAVORITES" | "ATTENTION";

const NEW_CUTOFF_HOURS = 40;
// «Ждут ссылку»: первые N карточек — самые свежие (клиент ещё тёплый), дальше
// хвост очереди от самых старых к новым.
const AWAITING_LINK_HEAD = 5;
// «Требуют внимания» (секция на вкладке «Все»): пороги просроченности.
const ATTENTION_BUYOUT_HOURS = 12;
const ATTENTION_LINK_DAYS = 5;
const ATTENTION_TAKE = 50;

let cachedCounts: {
  data: Record<string, number>;
  sums: Record<string, number>;
  oldest: Record<string, string | null>;
  ts: number;
} | null = null;
const COUNT_CACHE_TTL = 30_000;

// ── П5: живая цена геймпасса для карточек очереди (кэш product-info) ────────
const gpInfoCache = new Map<string, { price: number | null; isForSale: boolean; ts: number }>();
const GP_INFO_TTL = 10 * 60_000;

function gpIdOf(url: string | null | undefined): string | null {
  const m = url?.match(/game-pass(?:es)?\/(\d+)/);
  return m ? m[1] : null;
}

async function getGpInfoCached(gpId: string): Promise<{ price: number | null; isForSale: boolean } | null> {
  const hit = gpInfoCache.get(gpId);
  if (hit && Date.now() - hit.ts < GP_INFO_TTL) return hit;
  const urls = [
    `https://apis.roblox.com/game-passes/v1/game-passes/${gpId}/product-info`,
    `https://apis.roproxy.com/game-passes/v1/game-passes/${gpId}/product-info`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (r.ok) {
        const j: any = await r.json().catch(() => null);
        if (!j) continue;
        const entry = { price: j.PriceInRobux ?? null, isForSale: j.IsForSale ?? false, ts: Date.now() };
        gpInfoCache.set(gpId, entry);
        return entry;
      }
    } catch { /* try next */ }
  }
  return null;
}

// Дописать аудит-строку к adminNote (обрезка до 2000, как в attach-gamepass);
// одна и та же пометка повторно не дублируется (как annotateOnce автовыкупа).
async function appendAdminNote(orderId: string, line: string): Promise<void> {
  try {
    const o = await (prisma as any).wbOrder.findUnique({ where: { id: orderId }, select: { adminNote: true } });
    if (o?.adminNote?.includes(line)) return;
    const prefix = o?.adminNote ? `${o.adminNote}\n` : "";
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data: { adminNote: `${prefix}${line}`.slice(0, 2000) },
    });
  } catch { /* best-effort: аудит не должен ронять выкуп */ }
}

/** Find a safe full-price pass owned by the same seller for this donor. */
async function findFullPriceReplacement(
  order: any,
  cookie: string,
  currentGpId: string,
): Promise<{ info: ResolvedGamepass; resolvedName: string } | null> {
  const nick = order.robloxUsername ?? order.probableNick;
  if (!nick) return null;
  const found = await searchForSalePassesByNick(nick).catch(() => null);
  if (!found || found.status !== "ok") return null;

  const expected = Math.ceil(order.amount / 0.7);
  const plausible = found.passes.filter((pass) =>
    String(pass.gamepassId) !== currentGpId && Math.abs(pass.price - expected) <= 2,
  );
  if (plausible.length === 0) return null;

  const referenced = await (prisma as any).wbOrder.findMany({
    where: {
      id: { not: order.id },
      status: { in: ["AWAITING_PAYMENT", "PAYMENT_PENDING", "AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR"] },
      gamepassUrl: { not: null },
    },
    select: { gamepassUrl: true },
  });
  const usedIds = new Set<string>(referenced.map((row: any) => gpIdOf(row.gamepassUrl)).filter(Boolean));

  for (const pass of plausible) {
    const passId = String(pass.gamepassId);
    if (usedIds.has(passId)) continue;
    let info: ResolvedGamepass;
    try {
      info = await resolveGamepassForBuyer(passId, cookie);
    } catch {
      continue;
    }
    if (!info.isForSale || info.hasUnsafeBuyerPrice) continue;
    if (!checkGamepassPrice(order.amount, info.price, info.basePriceInRobux).ok) continue;
    if (!sellerMatchesOrder(found.resolvedName, info.sellerName)) continue;
    // null means the ownership check itself is unavailable: fail closed.
    if (await verifyGamepassOwnership(cookie, passId) !== false) continue;
    return { info, resolvedName: found.resolvedName };
  }
  return null;
}

function buildTabWhere(tab: FilterTab): any {
  const cutoff = new Date(Date.now() - NEW_CUTOFF_HOURS * 3600_000);
  switch (tab) {
    case "WORK":
      return {
        isFavorite: false,
        OR: [
          { status: "ERROR" },
          { status: { in: ["PENDING", "IN_PROGRESS"] }, isDirectOrder: false, orderSource: { not: "AVITO" } },
          { status: "AWAITING_GAMEPASS", createdAt: { lte: cutoff } },
        ],
      };
    case "ALL":
      return {};
    case "BUYOUT":
      return {
        isDirectOrder: false,
        orderSource: { not: "AVITO" },
        isFavorite: false,
        OR: [
          { status: { in: ["PENDING", "IN_PROGRESS"] } },
          { status: "ERROR", buyoutErrorCode: { in: [BUYOUT_ERROR_REGIONAL_PRICE, BUYOUT_ERROR_ROBLOX_PLUS_FLOW] } },
        ],
      };
    case "DIRECT":
      return { isDirectOrder: true, status: { in: ["PENDING", "IN_PROGRESS", "AWAITING_PAYMENT", "PAYMENT_PENDING", "ERROR"] }, isFavorite: false };
    case "AVITO":
      return { orderSource: "AVITO", status: { in: ["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS", "ERROR"] }, isFavorite: false };
    case "NEW":
      return { status: "AWAITING_GAMEPASS", createdAt: { gt: cutoff }, isFavorite: false };
    case "ERROR":
      return { status: "ERROR", isFavorite: false };
    case "AWAITING_LINK":
      return { status: "AWAITING_GAMEPASS", createdAt: { lte: cutoff }, isFavorite: false };
    case "DONE":
      return { status: "COMPLETED" };
    case "FAVORITES":
      return { isFavorite: true };
    case "ATTENTION": {
      const buyoutOverdue = new Date(Date.now() - ATTENTION_BUYOUT_HOURS * 3600_000);
      const linkOverdue = new Date(Date.now() - ATTENTION_LINK_DAYS * 24 * 3600_000);
      return {
        isFavorite: false,
        OR: [
          { status: "ERROR" },
          { status: { in: ["PENDING", "IN_PROGRESS"] }, isDirectOrder: false, orderSource: { not: "AVITO" }, pendingAt: { lte: buyoutOverdue } },
          { isDirectOrder: true, status: { in: ["AWAITING_PAYMENT", "PAYMENT_PENDING"] } },
          { status: "AWAITING_GAMEPASS", createdAt: { lte: linkOverdue } },
        ],
      };
    }
    default:
      return {};
  }
}

function orderByForTab(tab: FilterTab): any {
  if (tab === "WORK") return [{ updatedAt: "desc" }, { createdAt: "desc" }];
  if (tab === "BUYOUT" || tab === "DIRECT" || tab === "AVITO") return [{ pendingAt: "asc" }, { createdAt: "asc" }];
  if (tab === "ERROR" || tab === "AWAITING_LINK" || tab === "ATTENTION") return { createdAt: "asc" };
  return { createdAt: "desc" };
}

// Серьёзность внутри «Требуют внимания»: ошибка → подвисший выкуп →
// прямой ждёт оплату → давно ждут ссылку. Внутри группы — старые сверху
// (сортировка стабильная, базовый порядок createdAt asc сохраняется).
function attentionRank(o: { status: string }): number {
  if (o.status === "ERROR") return 0;
  if (o.status === "PENDING" || o.status === "IN_PROGRESS") return 1;
  if (o.status === "AWAITING_PAYMENT" || o.status === "PAYMENT_PENDING") return 2;
  return 3;
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
  const sourceFilter = searchParams.get("source") as string | null;

  const isVirtualTab = ["WORK", "ALL", "BUYOUT", "DIRECT", "AVITO", "NEW", "ERROR", "AWAITING_LINK", "DONE", "FAVORITES", "ATTENTION"].includes(tab);
  const tabWhere = isVirtualTab
    ? buildTabWhere(tab as FilterTab)
    : (VALID_STATUSES.includes(tab as any) ? { status: tab } : {});
  const orderBy = isVirtualTab ? orderByForTab(tab as FilterTab) : { createdAt: "desc" as const };

  let searchWhere: any = {};
  if (q) {
    const qClean = q.replace(/^@/, "");
    const qDigits = q.replace(/\D/g, "");
    const isNumericId = qDigits.length >= 4 && qDigits.length / q.length >= 0.8;
    const orClauses: any[] = [
      { gamepassUrl:    { contains: q,           mode: "insensitive" } },
      { robloxUsername: { contains: qClean,      mode: "insensitive" } },
      // adminNote держит «вероятные» ники ([НИК? дата] ник) — ищем и по ним.
      { adminNote:      { contains: qClean,      mode: "insensitive" } },
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
  const sourceWhere = sourceFilter && ["WB", "DIRECT", "AVITO", "MANUAL", "SITE"].includes(sourceFilter)
    ? { orderSource: sourceFilter }
    : {};
  const where = q
    ? { AND: [notTest, tabWhere, sourceWhere, searchWhere] }
    : { ...notTest, ...tabWhere, ...sourceWhere };

  const take = skipCounts ? limit + 1 : limit;
  const userInclude = {
    user: { select: {
      tgId: true, vkId: true, name: true, username: true,
      balance: true, reviewBonusGrantedAt: true,
    } },
    paymentAttempts: {
      orderBy: { createdAt: "desc" as const }, take: 1,
      select: { status: true, amountKopecks: true, refundedAmountKopecks: true },
    },
  };

  let ordersPromise: Promise<any[]>;
  if (tab === "ATTENTION") {
    // Секция небольшая по природе — берём одним куском (без пагинации)
    // и ранжируем по серьёзности уже в памяти.
    ordersPromise = (prisma as any).wbOrder
      .findMany({ where, orderBy, take: ATTENTION_TAKE, include: userInclude })
      .then((rows: any[]) => rows.sort((a, b) => attentionRank(a) - attentionRank(b)));
  } else if (tab === "AWAITING_LINK" && !q) {
    ordersPromise = fetchAwaitingLinkHybrid(where, skip, take, userInclude);
  } else {
    ordersPromise = (prisma as any).wbOrder.findMany({ where, orderBy, skip, take, include: userInclude });
  }

  const emptyCounts = {
    total: 0,
    counts: null as Record<string, number> | null,
    sums: null as Record<string, number> | null,
    oldest: null as Record<string, string | null> | null,
  };
  const countsPromise = skipCounts
    ? Promise.resolve(emptyCounts)
    : (async () => {
        if (!q) {
          if (cachedCounts && Date.now() - cachedCounts.ts < COUNT_CACHE_TTL) {
            return { total: tabTotal(tab, cachedCounts.data), counts: cachedCounts.data, sums: cachedCounts.sums, oldest: cachedCounts.oldest };
          }
          // Заявки прямых заказов (DirectIntent, «ожидаем реквизиты») живут 24ч;
          // бейдж вкладки «Прямой» = заказы + заявки (клиент складывает сам).
          const intentsPromise: Promise<number> = (prisma as any).directIntent.count({
            where: { status: "PENDING", createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } },
          }).catch(() => 0);
          const rows: any[] = await (prisma as any).$queryRawUnsafe(`
            SELECT
              COUNT(*) FILTER (WHERE "isFavorite" = false AND (
                status = 'ERROR'
                OR (status IN ('PENDING','IN_PROGRESS') AND "isDirectOrder" = false AND "orderSource" != 'AVITO')
                OR (status = 'AWAITING_GAMEPASS' AND "createdAt" <= NOW() - INTERVAL '${NEW_CUTOFF_HOURS} hours')
              ))::int AS "WORK",
              COUNT(*)::int AS "ALL",
              COUNT(*) FILTER (WHERE "isDirectOrder" = false AND "orderSource" != 'AVITO' AND "isFavorite" = false AND (status IN ('PENDING','IN_PROGRESS') OR (status = 'ERROR' AND "buyoutErrorCode" IN ('REGIONAL_PRICE','ROBLOX_PLUS_FLOW'))))::int AS "BUYOUT",
              COUNT(*) FILTER (WHERE "isDirectOrder" = true AND status IN ('PENDING','IN_PROGRESS','AWAITING_PAYMENT','PAYMENT_PENDING','ERROR') AND "isFavorite" = false)::int AS "DIRECT",
              COUNT(*) FILTER (WHERE "orderSource" = 'AVITO' AND status IN ('PENDING','IN_PROGRESS','AWAITING_GAMEPASS','ERROR') AND "isFavorite" = false)::int AS "AVITO",
              COUNT(*) FILTER (WHERE status = 'AWAITING_GAMEPASS' AND "createdAt" > NOW() - INTERVAL '${NEW_CUTOFF_HOURS} hours' AND "isFavorite" = false)::int AS "NEW",
              COUNT(*) FILTER (WHERE status = 'ERROR' AND "isFavorite" = false)::int AS "ERROR",
              COUNT(*) FILTER (WHERE status = 'AWAITING_GAMEPASS' AND "createdAt" <= NOW() - INTERVAL '${NEW_CUTOFF_HOURS} hours' AND "isFavorite" = false)::int AS "AWAITING_LINK",
              COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS "DONE",
              COUNT(*) FILTER (WHERE "isFavorite" = true)::int AS "FAVORITES",
              COUNT(*) FILTER (WHERE "isFavorite" = false AND (
                status = 'ERROR'
                OR (status IN ('PENDING','IN_PROGRESS') AND "isDirectOrder" = false AND "orderSource" != 'AVITO' AND "pendingAt" <= NOW() - INTERVAL '${ATTENTION_BUYOUT_HOURS} hours')
                OR ("isDirectOrder" = true AND status IN ('AWAITING_PAYMENT','PAYMENT_PENDING'))
                OR (status = 'AWAITING_GAMEPASS' AND "createdAt" <= NOW() - INTERVAL '${ATTENTION_LINK_DAYS} days')
              ))::int AS "ATTENTION",
              COALESCE(SUM(amount) FILTER (WHERE "isDirectOrder" = false AND "orderSource" != 'AVITO' AND "isFavorite" = false AND (status IN ('PENDING','IN_PROGRESS') OR (status = 'ERROR' AND "buyoutErrorCode" IN ('REGIONAL_PRICE','ROBLOX_PLUS_FLOW')))), 0)::int AS "SUM_BUYOUT",
              COALESCE(SUM(amount) FILTER (WHERE "isDirectOrder" = true AND status IN ('PENDING','IN_PROGRESS','AWAITING_PAYMENT','PAYMENT_PENDING','ERROR') AND "isFavorite" = false), 0)::int AS "SUM_DIRECT",
              COALESCE(SUM(amount) FILTER (WHERE "orderSource" = 'AVITO' AND status IN ('PENDING','IN_PROGRESS','AWAITING_GAMEPASS','ERROR') AND "isFavorite" = false), 0)::int AS "SUM_AVITO",
              COALESCE(SUM(amount) FILTER (WHERE status = 'AWAITING_GAMEPASS' AND "isFavorite" = false), 0)::int AS "SUM_AWAITING_LINK",
              COALESCE(SUM(amount) FILTER (WHERE status = 'AWAITING_GAMEPASS' AND "createdAt" > NOW() - INTERVAL '${NEW_CUTOFF_HOURS} hours' AND "isFavorite" = false), 0)::int AS "SUM_NEW",
              COALESCE(SUM(amount) FILTER (WHERE status = 'ERROR' AND "isFavorite" = false), 0)::int AS "SUM_ERROR",
              MIN("pendingAt") FILTER (WHERE status IN ('PENDING','IN_PROGRESS') AND "isDirectOrder" = false AND "orderSource" != 'AVITO' AND "isFavorite" = false) AS "OLDEST_BUYOUT",
              MIN("createdAt") FILTER (WHERE status = 'AWAITING_GAMEPASS' AND "createdAt" <= NOW() - INTERVAL '${NEW_CUTOFF_HOURS} hours' AND "isFavorite" = false) AS "OLDEST_AWAITING_LINK"
            FROM "WbOrder"
            WHERE "isTest" = false
          `);
          const r = rows[0] ?? {};
          const counts: Record<string, number> = {};
          const sums: Record<string, number> = {};
          for (const k of ["WORK", "ALL", "BUYOUT", "DIRECT", "AVITO", "NEW", "ERROR", "AWAITING_LINK", "DONE", "FAVORITES", "ATTENTION"] as const)
            counts[k] = Number(r[k] ?? 0);
          counts["INTENTS"] = await intentsPromise;
          for (const k of ["BUYOUT", "DIRECT", "AVITO", "AWAITING_LINK", "NEW", "ERROR"] as const)
            sums[k] = Number(r[`SUM_${k}`] ?? 0);
          const oldest: Record<string, string | null> = {
            BUYOUT: r["OLDEST_BUYOUT"] ? new Date(r["OLDEST_BUYOUT"]).toISOString() : null,
            AWAITING_LINK: r["OLDEST_AWAITING_LINK"] ? new Date(r["OLDEST_AWAITING_LINK"]).toISOString() : null,
          };
          cachedCounts = { data: counts, sums, oldest, ts: Date.now() };
          return { total: tabTotal(tab, counts), counts, sums, oldest };
        }
        const cnt = await (prisma as any).wbOrder.count({ where });
        return { ...emptyCounts, total: cnt };
      })();

  const [rawOrders, { total, counts, sums, oldest }] = await Promise.all([ordersPromise, countsPromise]);
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

  // ATTENTION отдаётся одним куском (до ATTENTION_TAKE) — пагинации нет.
  const pages = tab === "ATTENTION" ? 1 : Math.ceil(finalTotal / limit);
  const profitSummary = tab === "DONE" && !skipCounts
    ? await (prisma as any).wbOrder.aggregate({
        where,
        _sum: { profitKopecks: true },
        _count: { profitKopecks: true },
      })
    : null;
  return NextResponse.json({ orders, total: finalTotal, counts, sums, oldest, profitSummary, page, pages });
}

function tabTotal(tab: string, counts: Record<string, number>): number {
  return counts[tab] ?? counts["ALL"] ?? 0;
}

// «Ждут ссылку»: голова = AWAITING_LINK_HEAD самых свежих (desc), хвост = все
// остальные от самых старых (asc). Собирается на сервере, чтобы порядок
// переживал пагинацию; окно страницы [skip, skip+take) режется по обеим частям.
async function fetchAwaitingLinkHybrid(where: any, skip: number, take: number, include: any): Promise<any[]> {
  const head: any[] = await (prisma as any).wbOrder.findMany({
    where, orderBy: { createdAt: "desc" }, take: AWAITING_LINK_HEAD, include,
  });
  const headSlice = head.slice(skip, skip + take);
  const tailTake = take - headSlice.length;
  if (tailTake <= 0) return headSlice;
  const tail: any[] = await (prisma as any).wbOrder.findMany({
    where: { ...where, id: { notIn: head.map(h => h.id) } },
    orderBy: { createdAt: "asc" },
    skip: Math.max(0, skip - head.length),
    take: tailTake,
    include,
  });
  return [...headSlice, ...tail];
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
  const twaUser = await extractTwaUser(req);
  if (!twaUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.action)
    return NextResponse.json({ error: "action required" }, { status: 400 });

  const { action, orderId, reason } = body;

  if (action === "create-avito") {
    const { amount, gamepassUrl, robloxUsername, note } = body;
    const saleRubles = Number(body.saleRubles);
    if (!amount || typeof amount !== "number" || amount < 1)
      return NextResponse.json({ error: "amount обязателен (число > 0)" }, { status: 400 });
    if (!Number.isFinite(saleRubles) || saleRubles <= 0)
      return NextResponse.json({ error: "saleRubles обязателен для точной прибыли Авито" }, { status: 400 });

    // Дедуп: на этот геймпасс уже есть активный заказ → 409, пока менеджер
    // явно не подтвердит повтор (force: true). COMPLETED/REJECTED не блокируют.
    const gpMatch = String(gamepassUrl ?? "").match(/game-pass(?:es)?\/(\d+)/);
    if (gpMatch && body.force !== true) {
      const candidates = await (prisma as any).wbOrder.findMany({
        where: {
          isTest: false,
          status: { in: ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS"] },
          gamepassUrl: { contains: `/${gpMatch[1]}` },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { wbCode: true, status: true, orderSource: true, createdAt: true, gamepassUrl: true },
      });
      // `contains` может зацепить более длинный id — сверяем точным парсингом.
      const existing = candidates.find(
        (o: any) => (o.gamepassUrl ?? "").match(/game-pass(?:es)?\/(\d+)/)?.[1] === gpMatch[1],
      );
      if (existing) {
        return NextResponse.json(
          {
            error: `На этот геймпасс уже есть активный заказ ${existing.wbCode}`,
            existing: { wbCode: existing.wbCode, status: existing.status, orderSource: existing.orderSource, createdAt: existing.createdAt },
          },
          { status: 409 },
        );
      }
    }

    const code = `AV-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const settings = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });

    const created = await (prisma as any).wbOrder.create({
      data: {
        amount,
        gamepassUrl: gamepassUrl || null,
        robloxUsername: robloxUsername || null,
        status: gamepassUrl ? "PENDING" : "AWAITING_GAMEPASS",
        platform: "TG",
        wbCode: code,
        isDirectOrder: false,
        orderSource: "AVITO",
        saleAmountKopecks: Math.round(saleRubles * 100),
        adminNote: note || null,
        pendingAt: gamepassUrl ? new Date() : null,
        purchaserUsername: settings?.robloxAccountName ?? null,
        user: {
          connectOrCreate: {
            where: { tgId: "admin" },
            create: { tgId: "admin", name: "Admin (Avito)" },
          },
        },
      },
    });
    cachedCounts = null;
    return NextResponse.json({ ok: true, order: created });
  }

  // П4 (PLAN «+7»): живая валидация полей модалки «➕ Создать заказ».
  // Ничего не создаёт; предупреждения (цена/продавец) НЕ блокируют создание.
  if (action === "manual-validate") {
    const out: any = {};

    const rawCode = String(body.wbCode ?? "").trim().toUpperCase();
    if (rawCode) {
      if (!/^[A-Z0-9]{7}$/.test(rawCode)) {
        out.code = { ok: false, error: "Код — 7 символов A-Z/0-9" };
      } else {
        const codeRow = await (prisma as any).wbCode.findUnique({
          where: { code: rawCode },
          select: {
            denomination: true, isTest: true,
            user: { select: { id: true, tgId: true, vkId: true, name: true, username: true } },
          },
        });
        if (!codeRow) out.code = { ok: false, error: "Код не найден" };
        else if (codeRow.isTest) out.code = { ok: false, error: "Тестовый код" };
        else {
          const orderOnCode = await (prisma as any).wbOrder.findFirst({
            where: { wbCode: rawCode },
            select: { status: true },
          });
          if (orderOnCode) {
            out.code = { ok: false, error: `По коду уже есть заказ (${orderOnCode.status}) — используй 📎/rebind` };
          } else {
            out.code = { ok: true, denomination: codeRow.denomination, claimedBy: codeRow.user ?? null };
          }
        }
      }
    }

    const gpRaw = String(body.gamepassUrl ?? "").trim();
    const gpId = gpRaw.match(/game-pass(?:es)?\/(\d+)/)?.[1] ?? (/^\d{6,}$/.test(gpRaw) ? gpRaw : null);
    if (gpRaw && !gpId) out.gamepass = { error: "Нужна ссылка roblox.com/game-pass/<id> или ID" };
    else if (gpId) {
      const amount = Number(body.amount) || out.code?.denomination || 0;
      const expected = amount > 0 ? Math.ceil(amount / 0.7) : null;
      const info = await getGpInfoCached(gpId);
      const candidates = await (prisma as any).wbOrder.findMany({
        where: { isTest: false, status: { in: ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS"] }, gamepassUrl: { contains: `/${gpId}` } },
        orderBy: { createdAt: "desc" }, take: 5,
        select: { wbCode: true, status: true, gamepassUrl: true },
      });
      const existing = candidates.find((o: any) => gpIdOf(o.gamepassUrl) === gpId);
      // Продавец vs ник: числится ли пасс среди for-sale пассов этого ника.
      let sellerMatch: boolean | null = null;
      const nick = String(body.robloxUsername ?? "").trim().replace(/^@/, "");
      if (nick) {
        const res = await searchForSalePassesByNick(nick).catch(() => null);
        sellerMatch = res?.status === "ok" ? res.passes.some((p) => String(p.gamepassId) === gpId) : null;
      }
      out.gamepass = {
        gamepassId: gpId,
        livePrice: info?.price ?? null,
        isForSale: info?.isForSale ?? null,
        expected,
        priceMismatch: expected != null && info?.price != null && Math.abs(info.price - expected) > 2,
        sellerMatch,
        existing: existing ? { wbCode: existing.wbCode, status: existing.status } : null,
      };
    }

    return NextResponse.json(out);
  }

  // П4 (PLAN «+7»): ручное создание заказа целиком из TWA (кейс 2ZELJMZ — код
  // CLAIMED, заказа нет, attach/rebind не помогают). Паритет с ботовским флоу:
  // ре-привязка кода к клиенту, PENDING при геймпассе, опциональный увед клиенту
  // «как будто сам активировал» (notifyRebind).
  if (action === "create-manual") {
    const rawCode = String(body.wbCode ?? "").trim().toUpperCase() || null;
    const nick = String(body.robloxUsername ?? "").trim().replace(/^@/, "") || null;
    const noteText = String(body.note ?? "").trim() || null;
    const clientUserId = String(body.clientUserId ?? "").trim() || null;

    // 1) Код ВБ (опционален): существует, не тест, заказа по нему нет.
    let codeRow: any = null;
    if (rawCode) {
      if (!/^[A-Z0-9]{7}$/.test(rawCode))
        return NextResponse.json({ error: "Код — 7 символов A-Z/0-9" }, { status: 400 });
      codeRow = await (prisma as any).wbCode.findUnique({
        where: { code: rawCode },
        select: { id: true, denomination: true, isTest: true, usedAt: true },
      });
      if (!codeRow) return NextResponse.json({ error: `Код ${rawCode} не найден` }, { status: 400 });
      if (codeRow.isTest) return NextResponse.json({ error: `Код ${rawCode} — тестовый` }, { status: 400 });
      const orderOnCode = await (prisma as any).wbOrder.findFirst({
        where: { wbCode: rawCode }, select: { status: true },
      });
      if (orderOnCode)
        return NextResponse.json({ error: `По коду ${rawCode} уже есть заказ (${orderOnCode.status})` }, { status: 409 });
    }

    // 2) Номинал: из кода или руками.
    const amount = codeRow?.denomination ?? Number(body.amount);
    if (!amount || !Number.isFinite(amount) || amount < 1)
      return NextResponse.json({ error: "Укажи код ВБ или номинал в R$" }, { status: 400 });

    // 3) Клиент (опционален): без клиента — служебный юзер (как в Авито).
    let client: any = null;
    if (clientUserId) {
      client = await (prisma as any).user.findUnique({
        where: { id: clientUserId },
        select: { id: true, tgId: true, vkId: true, name: true, username: true },
      });
      if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 400 });
    }

    // 4) Геймпасс (опционален): дедуп как в create-avito (force обходит).
    const gpRaw = String(body.gamepassUrl ?? "").trim();
    const gpId = gpRaw.match(/game-pass(?:es)?\/(\d+)/)?.[1] ?? (/^\d{6,}$/.test(gpRaw) ? gpRaw : null);
    if (gpRaw && !gpId)
      return NextResponse.json({ error: "Геймпасс: нужна ссылка roblox.com/game-pass/<id> или ID" }, { status: 400 });
    if (gpId && body.force !== true) {
      const candidates = await (prisma as any).wbOrder.findMany({
        where: { isTest: false, status: { in: ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS"] }, gamepassUrl: { contains: `/${gpId}` } },
        orderBy: { createdAt: "desc" }, take: 5,
        select: { wbCode: true, status: true, orderSource: true, createdAt: true, gamepassUrl: true },
      });
      const existing = candidates.find((o: any) => gpIdOf(o.gamepassUrl) === gpId);
      if (existing)
        return NextResponse.json({
          error: `На этот геймпасс уже есть активный заказ ${existing.wbCode}`,
          existing: { wbCode: existing.wbCode, status: existing.status, orderSource: existing.orderSource, createdAt: existing.createdAt },
        }, { status: 409 });
    }

    const gamepassUrl = gpId ? `https://www.roblox.com/game-pass/${gpId}` : null;
    const code = rawCode ?? `MN-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const stamp = new Date().toISOString().slice(0, 10);
    const manualMark = `[MANUAL ${stamp} от ${twaUser.firstName}]`;
    const platform = client?.vkId && !client?.tgId ? "VK" : "TG";

    const created = await (prisma as any).$transaction(async (tx: any) => {
      const order = await tx.wbOrder.create({
        data: {
          amount,
          gamepassUrl,
          robloxUsername: nick,
          status: gamepassUrl ? "PENDING" : "AWAITING_GAMEPASS",
          platform,
          wbCode: code,
          isDirectOrder: false,
          orderSource: "MANUAL",
          adminNote: noteText ? `${manualMark} ${noteText}` : manualMark,
          pendingAt: gamepassUrl ? new Date() : null,
          user: client
            ? { connect: { id: client.id } }
            : { connectOrCreate: { where: { tgId: "admin" }, create: { tgId: "admin", name: "Admin (Manual)" } } },
        },
      });
      // Ре-привязка кода (паритет с ботовской активацией): код закрывается для
      // повторного использования и вешается на выбранного клиента.
      if (codeRow) {
        await tx.wbCode.update({
          where: { id: codeRow.id },
          data: {
            isUsed: true,
            status: "CLAIMED",
            usedAt: codeRow.usedAt ?? new Date(),
            ...(client ? { userId: client.id } : {}),
            ...(nick ? { robloxNick: nick } : {}),
          },
        });
      }
      return order;
    });

    // 5) Увед клиенту (checkbox в модалке; только при выбранном клиенте).
    let notified: "tg" | "vk" | null = null;
    if (body.notify === true && client) {
      notified = await notifyRebind(client, amount, code, !!gamepassUrl).catch(() => null);
    }

    cachedCounts = null;
    return NextResponse.json({ ok: true, order: created, notified });
  }

  // Не требует orderId — клиент шлёт только { action, query }.
  if (action === "search-users") {
    const q = String(body.query ?? "").trim();
    if (q.length < 2) return NextResponse.json({ error: "Минимум 2 символа" }, { status: 400 });

    const clean = q.replace(/^@/, "");
    const isNumeric = /^\d+$/.test(clean);

    const orClauses: any[] = [
      { username: { contains: clean, mode: "insensitive" } },
      { name: { contains: clean, mode: "insensitive" } },
      { robloxUsername: { contains: clean, mode: "insensitive" } },
    ];
    if (isNumeric) {
      orClauses.push({ tgId: clean });
      orClauses.push({ vkId: clean });
    }

    const users = await (prisma as any).user.findMany({
      where: { OR: orClauses },
      select: { id: true, tgId: true, vkId: true, username: true, name: true, robloxUsername: true },
      take: 10,
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ users });
  }

  // Не требует orderId — список заказов, к которым можно привязать геймпасс
  // из «Поиск и выкуп» (бот проспал ссылку / заказ отклонён / ошибка).
  if (action === "attachable-orders") {
    const q = String(body.query ?? "").trim();
    const qClean = q.replace(/^@/, "");
    const searchWhere = q.length >= 2
      ? {
          OR: [
            { wbCode:         { contains: q.toUpperCase() } },
            { robloxUsername: { contains: qClean, mode: "insensitive" } },
            // adminNote держит «вероятные» ники ([НИК? дата] ник) — ищем и по ним.
            { adminNote:      { contains: qClean, mode: "insensitive" } },
            { user: { username: { contains: qClean, mode: "insensitive" } } },
            { user: { name:     { contains: q,      mode: "insensitive" } } },
          ],
        }
      : {};

    const orders = await (prisma as any).wbOrder.findMany({
      where: {
        isTest: false,
        status: { in: ["AWAITING_GAMEPASS", "REJECTED", "ERROR"] },
        ...searchWhere,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, wbCode: true, amount: true, status: true, platform: true,
        robloxUsername: true, gamepassUrl: true, createdAt: true,
        user: { select: { tgId: true, vkId: true, name: true, username: true } },
      },
    });
    return NextResponse.json({ orders });
  }

  // Не требует orderId — обогащение карточек очереди выкупа: живая цена ГП
  // (⚠️ при расхождении с расчётной) и «этот геймпасс уже выкупался в <код>»
  // (сигнал, что донор может уже владеть пассом — Roblox не продаст вторую
  // копию тому же аккаунту). П5 (PLAN «+7»): карточка выкупа честнее.
  if (action === "gp-live-check") {
    const ids: string[] = Array.isArray(body.orderIds) ? body.orderIds.slice(0, 30).map(String) : [];
    if (ids.length === 0) return NextResponse.json({ results: {} });

    const checkOrders: any[] = await (prisma as any).wbOrder.findMany({
      where: { id: { in: ids } },
      select: { id: true, amount: true, gamepassUrl: true, wbCode: true },
    });
    const settings = await (prisma as any).globalSettings.findUnique({
      where: { id: "global" },
      select: { robloxCookie: true },
    });
    const buyerCookie = settings?.robloxCookie ?? null;

    const gpIds = [...new Set(checkOrders.map((o) => gpIdOf(o.gamepassUrl)).filter(Boolean))] as string[];
    const completed: any[] = gpIds.length > 0
      ? await (prisma as any).wbOrder.findMany({
          where: {
            isTest: false,
            status: "COMPLETED",
            OR: gpIds.map((id) => ({ gamepassUrl: { contains: `/${id}` } })),
          },
          orderBy: { updatedAt: "desc" },
          select: { wbCode: true, gamepassUrl: true },
        })
      : [];
    const reusedBy = new Map<string, string>();
    for (const c of completed) {
      const id = gpIdOf(c.gamepassUrl);
      if (id && !reusedBy.has(id)) reusedBy.set(id, c.wbCode);
    }

    const results: Record<string, any> = {};
    await Promise.all(checkOrders.map(async (o) => {
      const gpId = gpIdOf(o.gamepassUrl);
      if (!gpId) return;
      const expected = Math.ceil(o.amount / 0.7);
      const buyerInfo = buyerCookie
        ? await resolveGamepassForBuyer(gpId, buyerCookie).catch(() => null)
        : null;
      const publicInfo = buyerInfo ? null : await getGpInfoCached(gpId);
      const reusedCode = reusedBy.get(gpId);
      const livePrice = buyerInfo?.price ?? publicInfo?.price ?? null;
      const basePrice = buyerInfo?.basePriceInRobux ?? publicInfo?.price ?? null;
      results[o.id] = {
        expected,
        livePrice,
        basePrice,
        isForSale: buyerInfo?.isForSale ?? publicInfo?.isForSale ?? null,
        priceMismatch: basePrice != null && Math.abs(basePrice - expected) > 2,
        robloxPlusDiscountPercent: buyerInfo?.robloxPlusDiscountPercent ?? null,
        hasUnsafeBuyerPrice: buyerInfo?.hasUnsafeBuyerPrice ?? false,
        reusedIn: reusedCode && reusedCode !== o.wbCode ? reusedCode : null,
      };
    }));
    return NextResponse.json({ results });
  }

  if (!orderId)
    return NextResponse.json({ error: "orderId required" }, { status: 400 });

  const order = await (prisma as any).wbOrder.findUnique({
    where: { id: orderId },
    include: { user: { select: { id: true, tgId: true, vkId: true, username: true } } },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // П5 (PLAN «+7»): неоплаченный прямой заказ не должен доходить до выкупа
  // ни одним путём — робуксы донора тратятся только после подтверждения оплаты.
  const unpaidDirect = order.isDirectOrder && !order.paidAt;
  const UNPAID_DIR_ERROR = `💳 Прямой заказ ${order.wbCode} не оплачен — сначала подтверди оплату (pay_ok в TG-карточке)`;

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

  if (action === "restore-to-buyout") {
    const recovery = buildRestoreToBuyoutData(order, twaUser.firstName);
    if (!recovery.ok) {
      return NextResponse.json({ error: recovery.error }, { status: recovery.status });
    }
    const restored = await (prisma as any).wbOrder.updateMany({
      where: { id: orderId, status: "ERROR" },
      data: recovery.data,
    });
    if (restored.count !== 1) {
      return NextResponse.json({ error: "Заказ уже перемещён другим администратором" }, { status: 409 });
    }
    cachedCounts = null;
    return NextResponse.json({ ok: true, status: "PENDING" });
  }

  if (action === "move-to") {
    const target = body.target as string;
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note) return NextResponse.json({ error: "Заметка обязательна при переводе" }, { status: 400 });

    // «Избранное» — не статус, а флаг: заказ остаётся в своём статусе.
    if (target === "FAVORITES") {
      const stamp = new Date().toISOString().slice(0, 10);
      await (prisma as any).wbOrder.update({
        where: { id: orderId },
        data:  {
          isFavorite: true,
          adminNote: appendOrderAudit(
            order.adminNote,
            `[ПЕРЕНОС ${stamp} от ${twaUser.firstName}] → Избранное: ${note}`,
          ),
        },
      });
      cachedCounts = null;
      return NextResponse.json({ ok: true });
    }

    const statusMap: Record<string, string> = {
      BUYOUT: "PENDING",
      DIRECT: "PENDING",
      AVITO: "PENDING",
      NEW: "AWAITING_GAMEPASS",
      ERROR: "ERROR",
      AWAITING_LINK: "AWAITING_GAMEPASS",
      DONE: "COMPLETED",
    };
    const newStatus = statusMap[target];
    if (!newStatus) return NextResponse.json({ error: "Invalid target" }, { status: 400 });

    // Неоплаченный DIR нельзя руками перевести в очередь выкупа или «Готово» —
    // это открыло бы автовыкупу/менеджеру путь потратить робуксы без оплаты.
    if (unpaidDirect && (newStatus === "PENDING" || newStatus === "COMPLETED"))
      return NextResponse.json({ error: UNPAID_DIR_ERROR }, { status: 409 });

    const stamp = new Date().toISOString().slice(0, 10);
    const data: any = {
      status: newStatus,
      adminNote: appendOrderAudit(
        order.adminNote,
        `[ПЕРЕНОС ${stamp} от ${twaUser.firstName}] ${order.status}→${newStatus} (${target}): ${note}`,
      ),
      isFavorite: false,
    };
    if (target === "DIRECT") { data.isDirectOrder = true; data.orderSource = "DIRECT"; }
    if (target === "BUYOUT") { data.isDirectOrder = false; data.orderSource = order.orderSource === "AVITO" ? "MANUAL" : order.orderSource; }
    // Вкладка «Авито» фильтрует по orderSource — одного статуса мало.
    if (target === "AVITO")  { data.isDirectOrder = false; data.orderSource = "AVITO"; }
    // Перенос в «Готово» — тихая переклассификация (без уведомления клиенту,
    // в отличие от кнопки «Выкуплено»); курс фиксируем как при обычном выкупе.
    if (target === "DONE") {
      const settings = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
      data.purchaseRate = settings?.purchaseRate ?? null;
      data.completedAt = new Date(); // Ф6.3: базис таймера разблокировки робуксов
      Object.assign(data, buildOrderProfitSnapshot(order, settings ?? {}, Math.ceil(order.amount / 0.7)) ?? {});
    }
    if (target !== "ERROR") data.buyoutErrorCode = null;
    if (target === "AWAITING_LINK" || target === "NEW") data.pendingAt = null;
    if ((target === "BUYOUT" || target === "DIRECT" || target === "AVITO")
        && (order.status !== "PENDING" && order.status !== "IN_PROGRESS")) {
      data.pendingAt = new Date();
    }

    await (prisma as any).wbOrder.update({ where: { id: orderId }, data });
    cachedCounts = null;
    return NextResponse.json({ ok: true });
  }

  if (action === "complete") {
    if (unpaidDirect) return NextResponse.json({ error: UNPAID_DIR_ERROR }, { status: 409 });
    if (!["PENDING", "IN_PROGRESS", "ERROR"].includes(order.status))
      return NextResponse.json({ error: "Order must be PENDING, IN_PROGRESS or ERROR" }, { status: 400 });
    const settings = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
    const currentRate = settings?.purchaseRate ?? null;
    const purchaseRobux = Math.ceil(order.amount / 0.7);
    const money = buildOrderProfitSnapshot(order, settings ?? {}, purchaseRobux);
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data:  { status: "COMPLETED", buyoutErrorCode: null, purchaseRate: currentRate, completedAt: new Date(), ...(money ?? {}) },
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
      data:  { status: "REJECTED", buyoutErrorCode: null, rejectionReason },
    });
    cachedCounts = null;
    notifyOrderRejected(order.user, order.wbCode, rejectionReason, order.amount).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (action === "purchase") {
    if (unpaidDirect) return NextResponse.json({ error: UNPAID_DIR_ERROR }, { status: 409 });
    if (!["PENDING", "IN_PROGRESS", "ERROR"].includes(order.status))
      return NextResponse.json({ error: "Order must be PENDING, IN_PROGRESS or ERROR" }, { status: 400 });

    const gpMatch = order.gamepassUrl?.match(/game-pass(?:es)?\/(\d+)/);
    if (!gpMatch) return NextResponse.json({ error: "No gamepass URL" }, { status: 400 });
    let gpId = gpMatch[1];

    const settings = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
    const cookie = settings?.robloxCookie;
    if (!cookie) return NextResponse.json({ error: "Cookie не задан. /setcookie в боте" }, { status: 400 });

    // Fetch donor-specific info immediately before purchase. Typed Roblox Plus
    // is used for pack/accounting, but its cookie-only transport is blocked
    // below. Unknown/Regional differences still trigger replacement search.
    let info: ResolvedGamepass;
    try {
      info = await resolveGamepassForBuyer(gpId, cookie);
    } catch (err) {
      const status = err instanceof BuyoutError ? err.status : 502;
      return NextResponse.json({ error: err instanceof Error ? err.message : "Не удалось получить product-info" }, { status });
    }

    if (!info.isForSale)
      return NextResponse.json({ error: "Геймпасс не на продаже" }, { status: 400 });

    const stamp = new Date().toISOString().slice(0, 10);
    const unsafeBuyerPrice = info.hasUnsafeBuyerPrice;
    if (unsafeBuyerPrice) {
      const original = info;
      const replacement = await findFullPriceReplacement(order, cookie, gpId);
      if (!replacement) {
        const wasRegional = order.buyoutErrorCode === BUYOUT_ERROR_REGIONAL_PRICE;
        const line = `[РЕГ-ЦЕНА ${stamp}] GP ${gpId}: донор ${original.price} R$, база ${original.basePriceInRobux} R$; полная замена по нику не найдена`;
        await (prisma as any).wbOrder.update({
          where: { id: orderId },
          data: { status: "ERROR", buyoutErrorCode: BUYOUT_ERROR_REGIONAL_PRICE },
        });
        await appendAdminNote(orderId, line);
        cachedCounts = null;
        if (!wasRegional) {
          notifyRegionalPriceNeeded(order.user, order.wbCode, Math.ceil(order.amount / 0.7)).catch(() => {});
        }
        return NextResponse.json({
          ok: true,
          success: false,
          failureCode: BUYOUT_ERROR_REGIONAL_PRICE,
          status: "ERROR",
          msg: `Рег. цена ${original.price}/${original.basePriceInRobux} R$ — безопасной замены по нику не найдено`,
        });
      }

      gpId = String(replacement.info.gamepassId);
      info = replacement.info;
      await (prisma as any).wbOrder.update({
        where: { id: orderId },
        data: {
          gamepassUrl: `https://www.roblox.com/game-pass/${gpId}`,
          robloxUsername: replacement.resolvedName,
          buyoutErrorCode: null,
        },
      });
      await appendAdminNote(
        orderId,
        `[РЕГ-ЗАМЕНА ${stamp}] GP ${original.gamepassId} (${original.price}/${original.basePriceInRobux} R$) → GP ${gpId} (${info.price} R$)`,
      );
    }

    if (info.robloxPlusDiscountPercent) {
      await appendAdminNote(
        orderId,
        `[ROBLOX PLUS ${stamp}] GP ${gpId}: скидка ${info.robloxPlusDiscountPercent}%, списание ${info.price} R$, база продавца ${info.basePriceInRobux} R$`,
      );
    }

    const price = info.price;
    const base = info.basePriceInRobux;
    const creatorId = info.sellerId;
    const creatorName: string | null = info.sellerName;
    if (!unsafeBuyerPrice && order.buyoutErrorCode === BUYOUT_ERROR_REGIONAL_PRICE) {
      await (prisma as any).wbOrder.update({ where: { id: orderId }, data: { buyoutErrorCode: null } });
    }

    // ЦЕНА-СТОП (PLAN-gp-price-guard Ш1, инцидент 12.07): выкуп возможен только
    // по цене, ожидаемой из номинала заказа. Раньше покупали по live-цене без
    // сверки — клиент, поднявший цену пасса после приёма ботом, получал больше.
    // Статус заказа НЕ меняем: это проблема строки, не «ошибка выкупа».
    const { ok: priceOk, expected } = checkGamepassPrice(order.amount, price, base);
    if (!priceOk) {
      await appendAdminNote(orderId, `[ЦЕНА-СТОП ${stamp}] пасс ${price} R$ ≠ ожид ${expected} R$ — выкуп заблокирован`);
      return NextResponse.json({ ok: true, success: false,
        msg: `⛔ Цена пасса ${price} R$ ≠ ожидаемой ${expected} R$ (номинал ${order.amount}). Выкуп заблокирован — нужен пасс ровно за ${expected} R$.` });
    }
    // ПРОДАВЕЦ-СТОП: подтверждённый ник заказа должен совпадать с создателем
    // пасса (перенос seller-check из автовыкупа — ловит подменённый ГП).
    if (!sellerMatchesOrder(order.robloxUsername, creatorName)) {
      await appendAdminNote(orderId, `[ПРОДАВЕЦ-СТОП ${stamp}] продавец ${creatorName} ≠ ник ${order.robloxUsername} — выкуп заблокирован`);
      return NextResponse.json({ ok: true, success: false,
        msg: `⛔ Продавец пасса ${creatorName} ≠ нику заказа ${order.robloxUsername}. Выкуп заблокирован — проверь, чей это геймпасс.` });
    }

    // Production canary 2026-07-14: legacy Economy v1 rejects both base and
    // Plus buyer-price with PriceChanged; Economy v2 user-products returns 404
    // for game passes. Roblox documents PromptGamePassPurchase as the supported
    // Plus-aware flow. Do not spend/guess through an unsupported cookie API.
    if (info.robloxPlusDiscountPercent) {
      await (prisma as any).wbOrder.update({
        where: { id: orderId },
        data: { status: "ERROR", buyoutErrorCode: BUYOUT_ERROR_ROBLOX_PLUS_FLOW },
      });
      cachedCounts = null;
      return NextResponse.json({
        ok: true,
        success: false,
        failureCode: BUYOUT_ERROR_ROBLOX_PLUS_FLOW,
        status: "ERROR",
        buyerPrice: price,
        basePrice: base,
        discountPercent: info.robloxPlusDiscountPercent,
        msg: `Roblox Plus −${info.robloxPlusDiscountPercent}% распознан (${price}/${base} R$), но cookie-only покупка pass больше не поддерживается Roblox. Нужен donor без Plus или официальный client/experience flow.`,
      });
    }

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
        `https://economy.roblox.com/v1/purchases/products/${info.productId}`,
        {
          method: "POST",
          headers: {
            Cookie: `.ROBLOSECURITY=${cookie}`,
            "Content-Type": "application/json",
            "x-csrf-token": csrf,
          },
          body: JSON.stringify({
            expectedCurrency: 1,
            // Вторая линия гарда: цена провалидирована выше (±PRICE_TOL от
            // номинала), а строгую сверку expectedPrice против live делает сам
            // Roblox — гонку «цену подняли между проверкой и POST» он отклонит.
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

    const isAlreadyOwned = /already.?own/i.test(purchaseData?.reason ?? "");
    let purchased = Boolean(purchaseData?.purchased) || isAlreadyOwned;

    // Ф1: провал/«Нет ответа» не значит «не куплено» — Roblox при таймауте/5xx
    // нередко проводит транзакцию. Перед ERROR/502 проверяем владение донором.
    let recovered = false;
    const canonicalReason: string | null = purchaseData?.reason ?? purchaseData?.errorMsg ?? null;
    if (!purchased && needsOwnershipCheck(canonicalReason)) {
      const owned = await verifyOwnershipAfterFailure(cookie, gpId, canonicalReason !== null);
      if (owned === true) {
        purchased = true;
        recovered = true;
        console.warn(`[twa/orders] recovered: заказ ${order.wbCode} — владение подтверждено после ошибки «${canonicalReason ?? "нет ответа"}»`);
      }
    }

    if (purchased) {
      const currentRate = settings?.purchaseRate ?? null;
      const purchaserUsername = settings?.robloxAccountName ?? null;
      const money = buildOrderProfitSnapshot(order, settings ?? {}, Number(purchaseData?.price ?? price));
      await (prisma as any).wbOrder.updateMany({
        where: { id: orderId, status: { in: ["PENDING", "IN_PROGRESS", "ERROR"] } },
        data: { status: "COMPLETED", buyoutErrorCode: null, purchaseRate: currentRate, purchaserUsername, completedAt: new Date(), ...(money ?? {}) },
      });
      cachedCounts = null;
      notifyOrderCompleted(order.user, orderId, order.amount, order.isDirectOrder ?? false).catch(() => {});
      if (isAlreadyOwned) {
        return NextResponse.json({ ok: true, success: true, chargedPrice: 0, msg: "Куплено (AlreadyOwned — предыдущая покупка прошла)" });
      }
      if (recovered) {
        return NextResponse.json({ ok: true, success: true, chargedPrice: price, msg: `Куплено (владение подтверждено проверкой после ошибки: ${canonicalReason ?? "нет ответа от Roblox"})` });
      }
      return NextResponse.json({
        ok: true,
        success: true,
        robloxPlusDiscountPercent: info.robloxPlusDiscountPercent,
        chargedPrice: Number(purchaseData.price ?? price),
        basePrice: base,
        msg: `Куплено за ${purchaseData.price ?? price} R$`,
      });
    }

    if (!purchaseData)
      return NextResponse.json({ error: "Нет ответа от Roblox" }, { status: 502 });

    const failReason = purchaseData.reason ?? purchaseData.errorMsg ?? "Неизвестная ошибка";
    const legacyPurchaseFlowRemoved = isLegacyPurchaseFlowFailure(failReason);
    if (!legacyPurchaseFlowRemoved) {
      await (prisma as any).wbOrder.updateMany({
        where: { id: orderId, status: { in: ["PENDING", "IN_PROGRESS"] } },
        data: { status: "ERROR" },
      });
      cachedCounts = null;
    }
    // Expose only primitive response fields to the authenticated admin so a
    // new Roblox refusal can be diagnosed without logging cookies or tokens.
    const robloxDiagnostic = Object.fromEntries(
      Object.entries(purchaseData)
        .filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value))
        .slice(0, 20),
    );
    const robloxErrors = Array.isArray((purchaseData as any).errors)
      ? (purchaseData as any).errors.slice(0, 10).map((error: unknown) => {
          if (!error || typeof error !== "object" || Array.isArray(error)) return {};
          return Object.fromEntries(
            Object.entries(error)
              .filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value))
              .slice(0, 10),
          );
        })
      : [];
    return NextResponse.json({
      ok: true,
      success: false,
      msg: legacyPurchaseFlowRemoved
        ? "Roblox отключил legacy cookie-выкуп геймпассов. Заказ оставлен в очереди; нужен официальный in-experience purchase bridge."
        : failReason,
      failureCode: legacyPurchaseFlowRemoved ? BUYOUT_ERROR_LEGACY_PURCHASE_FLOW : undefined,
      status: legacyPurchaseFlowRemoved ? order.status : "ERROR",
      robloxHttpStatus: purchaseRes?.status ?? null,
      robloxDiagnostic,
      robloxErrors,
      robloxKeys: Object.keys(purchaseData).slice(0, 30),
    });
  }

  if (action === "edit-avito") {
    if (order.orderSource !== "AVITO")
      return NextResponse.json({ error: "Только для Авито-заказов" }, { status: 400 });
    if (!["PENDING", "AWAITING_GAMEPASS", "ERROR"].includes(order.status))
      return NextResponse.json({ error: "Нельзя редактировать в этом статусе" }, { status: 400 });

    const data: any = {};
    if (body.amount !== undefined) {
      const amt = Number(body.amount);
      if (!amt || amt < 1) return NextResponse.json({ error: "amount должен быть > 0" }, { status: 400 });
      data.amount = amt;
    }
    if (body.robloxUsername !== undefined) data.robloxUsername = body.robloxUsername || null;
    if (body.note !== undefined) data.adminNote = typeof body.note === "string" ? body.note.trim().slice(0, 2000) || null : null;
    if (body.gamepassUrl !== undefined) {
      const raw = String(body.gamepassUrl ?? "").trim();
      if (raw) {
        data.gamepassUrl = raw.includes("roblox.com") ? raw : /^\d+$/.test(raw) ? `https://www.roblox.com/game-pass/${raw}` : raw;
        data.buyoutErrorCode = null;
        if (!order.gamepassUrl) { data.status = "PENDING"; data.pendingAt = new Date(); }
      } else {
        data.gamepassUrl = null;
        data.buyoutErrorCode = null;
        data.status = "AWAITING_GAMEPASS";
        data.pendingAt = null;
      }
    }
    if (Object.keys(data).length === 0)
      return NextResponse.json({ error: "Нет данных для обновления" }, { status: 400 });

    await (prisma as any).wbOrder.update({ where: { id: orderId }, data });
    cachedCounts = null;
    return NextResponse.json({ ok: true });
  }

  // Универсальное редактирование заказа из карточки (обобщение edit-avito на
  // все источники): менеджер правит номинал/ник/геймпасс ЗА клиента — кейс
  // QARJR71 12.07 (замена подставленного пасса + корректировка номинала).
  // Заметка правится в NotesEditor карточки; изменения аудируются в adminNote.
  if (action === "edit-order") {
    if (unpaidDirect) return NextResponse.json({ error: UNPAID_DIR_ERROR }, { status: 409 });
    if (!["PENDING", "AWAITING_GAMEPASS", "ERROR"].includes(order.status))
      return NextResponse.json({ error: "Нельзя редактировать в этом статусе" }, { status: 400 });

    const data: any = {};
    const changes: string[] = [];

    if (body.amount !== undefined) {
      const amt = Number(body.amount);
      if (!amt || !Number.isFinite(amt) || amt < 1)
        return NextResponse.json({ error: "amount должен быть > 0" }, { status: 400 });
      if (order.isDirectOrder && amt !== order.amount)
        return NextResponse.json({ error: "У прямого заказа номинал привязан к оплате — правь ник/геймпасс" }, { status: 400 });
      if (amt !== order.amount) { data.amount = amt; changes.push(`номинал ${order.amount}→${amt}`); }
    }

    if (body.robloxUsername !== undefined) {
      const nick = String(body.robloxUsername ?? "").trim().replace(/^@/, "") || null;
      if (nick !== (order.robloxUsername ?? null)) {
        data.robloxUsername = nick;
        changes.push(`ник ${order.robloxUsername ?? "—"}→${nick ?? "—"}`);
      }
    }

    if (body.gamepassUrl !== undefined) {
      const raw = String(body.gamepassUrl ?? "").trim();
      const gpId = raw.match(/game-pass(?:es)?\/(\d+)/)?.[1] ?? (/^\d{6,}$/.test(raw) ? raw : null);
      if (raw && !gpId)
        return NextResponse.json({ error: "Геймпасс: нужна ссылка roblox.com/game-pass/<id> или ID" }, { status: 400 });
      const oldId = gpIdOf(order.gamepassUrl);
      if ((gpId ?? null) !== (oldId ?? null)) {
        // Дедуп как в create-manual: ГП уже в другом активном заказе → 409,
        // force обходит (осознанное решение менеджера).
        if (gpId && body.force !== true) {
          const candidates = await (prisma as any).wbOrder.findMany({
            where: { isTest: false, id: { not: orderId }, status: { in: ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS"] }, gamepassUrl: { contains: `/${gpId}` } },
            orderBy: { createdAt: "desc" }, take: 5,
            select: { wbCode: true, status: true, gamepassUrl: true },
          });
          const existing = candidates.find((o: any) => gpIdOf(o.gamepassUrl) === gpId);
          if (existing)
            return NextResponse.json({
              error: `На этот геймпасс уже есть активный заказ ${existing.wbCode}`,
              existing: { wbCode: existing.wbCode, status: existing.status },
            }, { status: 409 });
        }
        data.gamepassUrl = gpId ? `https://www.roblox.com/game-pass/${gpId}` : null;
        data.buyoutErrorCode = null;
        changes.push(gpId ? `ГП ${oldId ?? "—"}→${gpId}` : `ГП ${oldId} снят`);
        // Переходы статуса — паритет с edit-avito: появился пасс → в очередь,
        // сняли пасс → ждать ссылку. Замена пасса в ERROR статус не трогает.
        if (!gpId) { data.status = "AWAITING_GAMEPASS"; data.pendingAt = null; }
        else if (!order.gamepassUrl) { data.status = "PENDING"; data.pendingAt = new Date(); }
      }
    }

    if (Object.keys(data).length === 0)
      return NextResponse.json({ error: "Нет изменений" }, { status: 400 });

    await (prisma as any).wbOrder.update({ where: { id: orderId }, data });
    const stamp = new Date().toISOString().slice(0, 10);
    await appendAdminNote(orderId, `[EDIT ${stamp} от ${twaUser.firstName}] ${changes.join(", ")}`);
    cachedCounts = null;
    return NextResponse.json({ ok: true });
  }

  if (action === "set-source") {
    const src = body.source as string;
    if (!["WB", "DIRECT", "AVITO", "MANUAL"].includes(src))
      return NextResponse.json({ error: "Invalid source" }, { status: 400 });
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data: { orderSource: src },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "purchase-script") {
    if (unpaidDirect) return NextResponse.json({ error: UNPAID_DIR_ERROR }, { status: 409 });
    const gpMatch = order.gamepassUrl?.match(/game-pass(?:es)?\/(\d+)/);
    if (!gpMatch) return NextResponse.json({ error: "No gamepass URL" }, { status: 400 });
    const gpId = gpMatch[1];

    const settings = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
    const donorCookie = settings?.robloxCookie as string | null | undefined;
    if (!donorCookie)
      return NextResponse.json({ error: "Cookie не задан. /setcookie в боте" }, { status: 400 });

    let info: ResolvedGamepass;
    try {
      info = await resolveGamepassForBuyer(gpId, donorCookie);
    } catch (err) {
      const status = err instanceof BuyoutError ? err.status : 502;
      return NextResponse.json({ error: err instanceof Error ? err.message : "Не удалось получить персональную цену Roblox" }, { status });
    }

    const price = info.price;
    const base = info.basePriceInRobux;
    const isManagedPricing = info.isManagedPricing;
    const isForSale = info.isForSale;
    const creatorId = info.sellerId;
    const creatorName = info.sellerName;
    const name = info.name;

    if (info.robloxPlusDiscountPercent) {
      return NextResponse.json({
        error: `Roblox Plus −${info.robloxPlusDiscountPercent}% распознан (${price}/${base} R$), но cookie-only скрипт покупки pass не поддерживается Roblox`,
        failureCode: BUYOUT_ERROR_ROBLOX_PLUS_FLOW,
      }, { status: 409 });
    }
    if (info.hasUnsafeBuyerPrice) {
      return NextResponse.json({
        error: `Рег. или неизвестная цена ${price}/${base} R$ — скрипт не выдан`,
        failureCode: BUYOUT_ERROR_REGIONAL_PRICE,
      }, { status: 409 });
    }

    // ЦЕНА-СТОП (PLAN-gp-price-guard Ш2): скрипт с live-ценой радостно купил бы
    // и подороженный пасс — при расхождении с номиналом скрипт не выдаётся.
    const { ok: priceOk, expected } = checkGamepassPrice(order.amount, price);
    if (!priceOk)
      return NextResponse.json(
        { error: `⛔ Цена пасса ${price} R$ ≠ ожидаемой ${expected} R$ (номинал ${order.amount}) — скрипт не выдан` },
        { status: 409 },
      );

    // В скрипт зашита ожидаемая по номиналу цена (не live): даже скопированный
    // заранее скрипт откажется покупать, если цена пасса уже не ровно ожидаемая.
    // buyerUserId — [АККАУНТ-СТОП]: скрипт не сработает в чужой сессии, где залогинен
    // не донор, а личный аккаунт менеджера.
    const script = buildGamepassPurchaseScript({
      gamepassId: gpId,
      productId: info.productId,
      expectedPrice: expected,
      sellerId: creatorId,
      buyerUserId: await getAuthenticatedUserId(donorCookie),
    });

    return NextResponse.json({
      ok: true, script, name, price, base, creatorName,
      isForSale, isManagedPricing, gamepassId: gpId,
      pageUrl: gamepassPageUrl(gpId),
    });
  }

  if (action === "attach-gamepass") {
    // attach переводит заказ в PENDING (очередь выкупа) — для неоплаченного DIR закрыто.
    if (unpaidDirect) return NextResponse.json({ error: UNPAID_DIR_ERROR }, { status: 409 });
    const raw = String(body.gamepassId ?? "").trim();
    const idMatch = raw.match(/game-pass(?:es)?\/(\d+)/i) ?? raw.match(/^(\d+)$/);
    if (!idMatch)
      return NextResponse.json({ error: "gamepassId обязателен (ID или URL)" }, { status: 400 });
    const gamepassUrl = `https://www.roblox.com/game-pass/${idMatch[1]}`;

    const ATTACHABLE = ["AWAITING_GAMEPASS", "REJECTED", "ERROR", "PENDING"];
    if (!ATTACHABLE.includes(order.status))
      return NextResponse.json({ error: `Нельзя привязать геймпасс к заказу в статусе ${order.status}` }, { status: 400 });

    const now = new Date().toISOString().slice(0, 10);
    const auditNote = `[GP-ATTACH ${now}] ${gamepassUrl} (вручную из TWA)`;
    const existingNote = order.adminNote ? order.adminNote + "\n" : "";

    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data: {
        gamepassUrl,
        status: "PENDING",
        pendingAt: order.status === "PENDING" ? order.pendingAt : new Date(),
        rejectionReason: null,
        adminId: null,
        adminNote: (existingNote + auditNote).slice(0, 2000),
        buyoutErrorCode: null,
      },
    });
    cachedCounts = null;

    // Дожидаемся реальной отправки: менеджер должен знать, дошло ли уведомление
    // (VK error 901 у юзеров без диалога с сообществом теряется молча).
    const notified = await notifyGamepassAttached(order.user, order.wbCode).catch(() => null);

    return NextResponse.json({
      ok: true,
      wbCode: order.wbCode,
      notified,
    });
  }

  if (action === "rebind-order") {
    const { targetUserId, note } = body;
    if (!targetUserId) return NextResponse.json({ error: "targetUserId обязателен" }, { status: 400 });

    const REBINDABLE = ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR"];
    if (!REBINDABLE.includes(order.status))
      return NextResponse.json({ error: `Нельзя перепривязать заказ в статусе ${order.status}` }, { status: 400 });

    const targetUser = await (prisma as any).user.findUnique({
      where: { id: targetUserId },
      select: { id: true, tgId: true, vkId: true, username: true, name: true },
    });
    if (!targetUser) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

    if (targetUser.id === order.userId)
      return NextResponse.json({ error: "Заказ уже привязан к этому пользователю" }, { status: 400 });

    const newPlatform = targetUser.tgId ? "TG" : "VK";
    const oldLabel = order.user?.username || order.user?.tgId || order.user?.vkId || order.userId;
    const newLabel = targetUser.username || targetUser.tgId || targetUser.vkId || targetUser.id;
    const now = new Date().toISOString().slice(0, 10);
    const auditNote = `[REBIND ${now}] ${order.platform}:${oldLabel} → ${newPlatform}:${newLabel}` + (note ? ` (${note})` : "");

    const existingNote = order.adminNote ? order.adminNote + "\n" : "";

    await (prisma as any).$transaction([
      (prisma as any).wbOrder.update({
        where: { id: orderId },
        data: {
          userId: targetUser.id,
          platform: newPlatform,
          adminNote: (existingNote + auditNote).slice(0, 2000),
        },
      }),
      (prisma as any).wbCode.updateMany({
        where: { code: order.wbCode },
        data: { userId: targetUser.id },
      }),
    ]);

    cachedCounts = null;

    // Дожидаемся отправки — менеджер должен видеть, дошло ли (VK 901 молчалив).
    const notified = await notifyRebind(targetUser, order.amount, order.wbCode, !!order.gamepassUrl).catch(() => null);

    return NextResponse.json({ ok: true, platform: newPlatform, notified });
  }

  // ── 👁 GP-watch из карточки: live-поиск ГП по вероятному нику + пинг клиенту ─
  // Кнопка «Найти ГП и оповестить» / «Оповестить ещё раз» во вкладке «Ждут ссылку».
  if (action === "gpwatch-notify") {
    if (order.status !== "AWAITING_GAMEPASS")
      return NextResponse.json({ error: `Заказ уже в статусе ${order.status}` }, { status: 400 });
    const nick = order.probableNick ?? order.robloxUsername;
    if (!nick)
      return NextResponse.json({ error: "У заказа нет вероятного ника" }, { status: 400 });

    const search = await searchForSalePassesByNick(nick);
    if (search.status === "user_not_found")
      return NextResponse.json({ error: `Ник «${nick}» не найден на Roblox` }, { status: 404 });
    if (search.status === "error")
      return NextResponse.json({ error: "Roblox не ответил — попробуй ещё раз" }, { status: 502 });

    const want = Math.ceil(order.amount / 0.7);
    const match = search.passes
      .filter((p) => Math.abs(p.price - want) <= 2)
      .sort((a, b) => Math.abs(a.price - want) - Math.abs(b.price - want))[0];
    if (!match)
      return NextResponse.json({
        found: false,
        want,
        passes: search.passes.length,
        error: `У «${nick}» нет геймпасса за ${want} R$ (в продаже: ${search.passes.length})`,
      }, { status: 404 });

    const notified = await notifyGpWatchPing(order.user, order.id, nick, match.name, match.price).catch(() => null);
    if (notified) {
      await (prisma as any).wbOrder.update({
        where: { id: orderId },
        data: { gpWatchNotifiedPassId: String(match.gamepassId), gpWatchLastCheckAt: new Date() },
      });
    }

    return NextResponse.json({
      ok: true,
      found: true,
      pass: { gamepassId: match.gamepassId, name: match.name, price: match.price },
      notified,
    });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
