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

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const query = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ error: "Минимум 2 символа" }, { status: 400 });

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
    clauses.push({ gamepassUrl: { contains: digits } });
  }

  const ordersPromise = prisma.wbOrder.findMany({
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
    if (gpId) {
      const pass = await lookupGamepass(gpId);
      if (!pass) partialErrors.push("Roblox: геймпасс временно недоступен");
      return pass ? [pass] : [];
    }
    if (clean.length < 3 || /\s/.test(clean)) return [];
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

  const [orders, gamepasses] = await Promise.all([ordersPromise, livePromise]);
  const matchedOrders = orders.map(order => ({
    ...order,
    source: "db" as const,
    matchReason: getOrderMatchReason(order, query),
  }));
  return NextResponse.json({
    query,
    orders: matchedOrders,
    gamepasses: gamepasses.map(pass => ({ ...pass, source: "live" as const })),
    counts: { all: matchedOrders.length + gamepasses.length, orders: matchedOrders.length, gamepasses: gamepasses.length },
    partialErrors,
  });
}
