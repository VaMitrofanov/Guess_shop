import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";
import { searchForSalePassesByNick } from "@/lib/roblox-gamepass-search";
import type { Prisma } from "@prisma/client";
import { getOrderMatchReason } from "@/lib/twa-search-match";

interface RobloxProductInfo {
  Name?: string;
  PriceInRobux?: number;
  IsForSale?: boolean;
  Creator?: { Name?: string; Id?: number; CreatorTargetId?: number };
}

function gamepassId(value: string): string | null {
  return value.match(/game-pass(?:es)?\/(\d+)/i)?.[1]
    ?? (/^\d{6,20}$/.test(value) ? value : null);
}

async function lookupGamepass(id: string) {
  for (const host of ["apis.roblox.com", "apis.roproxy.com"]) {
    try {
      const response = await fetch(`https://${host}/game-passes/v1/game-passes/${id}/product-info`, {
        signal: AbortSignal.timeout(6_000),
      });
      if (!response.ok) continue;
      const item = await response.json() as RobloxProductInfo;
      return {
        gamepassId: Number(id),
        name: item.Name ?? "Gamepass",
        price: Number(item.PriceInRobux ?? 0),
        sellerName: item.Creator?.Name ?? null,
        sellerId: item.Creator?.Id ?? item.Creator?.CreatorTargetId ?? null,
        isForSale: Boolean(item.IsForSale),
        url: `https://www.roblox.com/game-pass/${id}`,
        observedAt: new Date().toISOString(),
        matchReason: "по gamepass ID",
      };
    } catch { /* try fallback */ }
  }
  return null;
}

/** Это НАШ код, а не ник Roblox?
 *
 *  Ходить с кодом гейта в Roblox бессмысленно и дорого: мост ждёт до 20 с
 *  (`roblox-bridge.ts`), прямая ветка — до тридцати, и всё это время ответ
 *  поиска не отдаётся вообще. Именно на этом «долго ищется» и стоял поиск по
 *  коду NGS22UR.
 *
 *  Проверяем по базе, а не по форме строки: `gidtiv1` — тоже семь символов с
 *  цифрой, и запретить по маске значило бы перестать искать живые ники. Код
 *  уникален и проиндексирован, лишний запрос стоит миллисекунды против
 *  двадцати секунд ожидания Roblox. */
async function isOurCode(value: string): Promise<boolean> {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{7}$/.test(code)) return false;
  try {
    return (await prisma.wbCode.count({ where: { code } })) > 0;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const query = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ error: "Минимум 2 символа" }, { status: 400 });
  /* Две половины поиска отвечают в разном темпе, поэтому и запрашиваются
     порознь: база — десятки миллисекунд, Roblox — секунды.
     `scope=db` отдаёт заказы и DBS сразу, `scope=roblox` дотягивает пассы.
     Раньше всё это складывалось в один `Promise.all`, и готовый DBS-заказ ждал
     Roblox — до двадцати секунд на запрос, который к Roblox не относился. */
  const scope = req.nextUrl.searchParams.get("scope") ?? "all";
  const wantDb = scope === "all" || scope === "db";
  const robloxAllowed = scope === "all" || scope === "roblox";

  const clean = query.replace(/^@/, "");
  const digits = query.replace(/\D/g, "");
  const gpId = gamepassId(query);
  const partialErrors: string[] = [];
  const clauses: Prisma.WbOrderWhereInput[] = [
    { wbCode: { contains: query.toUpperCase() } },
    { id: { endsWith: query.toLowerCase() } },
    { robloxUsername: { contains: clean, mode: "insensitive" } },
    { probableNick: { contains: clean, mode: "insensitive" } },
    { gamepassUrl: { contains: query, mode: "insensitive" } },
    { user: { username: { contains: clean, mode: "insensitive" } } },
    { user: { name: { contains: query, mode: "insensitive" } } },
  ];
  if (digits.length >= 4) {
    clauses.push({ user: { tgId: { contains: digits } } });
    clauses.push({ user: { vkId: { contains: digits } } });
    // U18: цифровой запрос ищем по индексируемому gamepassId.
    clauses.push({ gamepassId: digits });
  }

  // Заказы DBS живут в своей таблице и до 30.08.2026 искались только со своего
  // экрана: номер `#31401299` и имя покупателя из чата WB не находились больше
  // ниоткуда. Поиск один на приложение — значит и они в нём.
  const dbsPromise = !wantDb ? Promise.resolve([]) : prisma.wbMarketplaceOrder.findMany({
    where: {
      isTest: false,
      OR: [
        ...(digits.length >= 3 ? [{ wbOrderId: { contains: digits } }] : []),
        { buyerName: { contains: clean, mode: "insensitive" as const } },
        { wbCode: { code: { contains: query.toUpperCase() } } },
      ],
    },
    orderBy: { firstSeenAt: "desc" },
    take: 5,
    select: {
      id: true, wbOrderId: true, buyerName: true, supplierStatus: true,
      denominationSnapshot: true, completedAt: true, cancelledAt: true,
      wbCode: { select: { code: true } },
    },
  }).catch(() => []);

  const ordersPromise = !wantDb ? Promise.resolve([]) : prisma.wbOrder.findMany({
    where: { isTest: false, OR: clauses },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true, wbCode: true, amount: true, status: true, orderSource: true,
      robloxUsername: true, probableNick: true, gamepassUrl: true, createdAt: true,
      saleAmountKopecks: true, purchaseCostKopecks: true, profitKopecks: true,
      user: { select: { username: true, name: true, tgId: true, vkId: true } },
    },
  });

  const livePromise = (async () => {
    if (!robloxAllowed) return [];
    if (gpId) {
      const pass = await lookupGamepass(gpId);
      if (!pass) partialErrors.push("Roblox: геймпасс временно недоступен");
      return pass ? [pass] : [];
    }
    if (clean.length < 3 || /\s/.test(clean)) return [];
    // Номер заказа WB и код гейта — не ники: в Roblox с ними идти незачем.
    if (/^\d{4,}$/.test(clean) || await isOurCode(clean)) return [];
    try {
      const found = await searchForSalePassesByNick(clean);
      if (found.status !== "ok") {
        if (found.status === "error") partialErrors.push("Roblox: live-поиск временно недоступен");
        return [];
      }
      const observedAt = new Date().toISOString();
      return found.passes.slice(0, 8).map(pass => ({
        ...pass,
        sellerName: found.resolvedName,
        sellerId: found.userId,
        isForSale: true,
        url: `https://www.roblox.com/game-pass/${pass.gamepassId}`,
        observedAt,
        matchReason: "по Roblox-нику",
      }));
    } catch {
      partialErrors.push("Roblox: live-поиск превысил таймаут");
      return [];
    }
  })();

  const [orders, gamepasses, dbs] = await Promise.all([ordersPromise, livePromise, dbsPromise]);
  const matchedOrders = orders.map(order => ({
    ...order,
    source: "db" as const,
    matchReason: getOrderMatchReason(order, query),
  }));
  return NextResponse.json({
    query,
    orders: matchedOrders,
    gamepasses: gamepasses.map(pass => ({ ...pass, source: "live" as const })),
    dbs: dbs.map(order => ({
      id: order.id,
      wbOrderId: order.wbOrderId,
      buyerName: order.buyerName,
      supplierStatus: order.supplierStatus,
      denomination: order.denominationSnapshot,
      code: order.wbCode?.code ?? null,
      closed: Boolean(order.completedAt || order.cancelledAt),
    })),
    counts: {
      all: matchedOrders.length + gamepasses.length + dbs.length,
      orders: matchedOrders.length,
      gamepasses: gamepasses.length,
      dbs: dbs.length,
    },
    partialErrors,
  });
}
