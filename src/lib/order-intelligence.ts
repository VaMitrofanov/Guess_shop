import { prisma } from "@/lib/prisma";

interface RobloxProductInfo {
  Name?: string;
  PriceInRobux?: number;
  IsForSale?: boolean;
  Creator?: { Name?: string };
}

function passId(url: string | null): string | null {
  return url?.match(/game-pass(?:es)?\/(\d+)/i)?.[1] ?? null;
}

async function liveGamepass(id: string | null) {
  if (!id) return null;
  for (const host of ["apis.roblox.com", "apis.roproxy.com"]) {
    try {
      const response = await fetch(`https://${host}/game-passes/v1/game-passes/${id}/product-info`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) continue;
      const item = await response.json() as RobloxProductInfo;
      return {
        id,
        name: item.Name ?? "Gamepass",
        livePrice: Number(item.PriceInRobux ?? 0),
        isForSale: Boolean(item.IsForSale),
        sellerName: item.Creator?.Name ?? null,
        observedAt: new Date().toISOString(),
      };
    } catch { /* fallback */ }
  }
  return null;
}

export async function getOrderIntelligence(orderId: string) {
  const order = await prisma.wbOrder.findUnique({
    where: { id: orderId },
    include: {
      user: { include: { identities: { select: { provider: true, subject: true, verifiedAt: true } } } },
      paymentAttempts: {
        orderBy: { createdAt: "desc" }, take: 3,
        select: { status: true, amountKopecks: true, refundedAmountKopecks: true, provider: true, updatedAt: true },
      },
      events: { orderBy: { createdAt: "desc" }, take: 8, select: { type: true, createdAt: true } },
    },
  });
  if (!order) return null;

  const id = passId(order.gamepassUrl);
  const [live, related, userStats, reused] = await Promise.all([
    liveGamepass(id),
    prisma.wbOrder.findMany({
      where: { userId: order.userId, id: { not: order.id }, isTest: false },
      orderBy: { createdAt: "desc" }, take: 5,
      select: { id: true, wbCode: true, status: true, amount: true, orderSource: true, createdAt: true },
    }),
    prisma.wbOrder.groupBy({
      by: ["status"], where: { userId: order.userId, isTest: false }, _count: { _all: true }, _sum: { amount: true },
    }),
    id ? prisma.wbOrder.findFirst({
      where: { id: { not: order.id }, isTest: false, gamepassUrl: { contains: `/${id}` } },
      orderBy: { createdAt: "desc" }, select: { id: true, wbCode: true, status: true },
    }) : null,
  ]);

  const warnings: string[] = [];
  const partialErrors: string[] = [];
  const expected = Math.ceil(order.amount / 0.7);
  if (id && !live) partialErrors.push("Live-данные Roblox недоступны");
  if (live && !live.isForSale) warnings.push("Геймпасс снят с продажи");
  if (live && Math.abs(live.livePrice - expected) > 2) warnings.push(`Цена ${live.livePrice} R$ не совпадает с ожидаемой ${expected} R$`);
  if (reused) warnings.push(`Этот геймпасс уже связан с заказом ${reused.wbCode}`);
  if (order.gpWatchDeclinedAt) warnings.push("Клиент отклонил найденный Roblox-ник");

  return {
    completeness: partialErrors.length ? "PARTIAL" : "FULL",
    observedAt: new Date().toISOString(),
    order: {
      id: order.id, code: order.wbCode, source: order.orderSource, status: order.status,
      amount: order.amount, robloxUsername: order.robloxUsername ?? order.probableNick,
      createdAt: order.createdAt, pendingAt: order.pendingAt, completedAt: order.completedAt,
      favorite: order.isFavorite, note: order.adminNote,
    },
    client: {
      displayName: order.user?.name, username: order.user?.username,
      tgId: order.user?.tgId, vkId: order.user?.vkId, email: order.user?.email,
      identities: order.user?.identities ?? [], balance: order.user?.balance ?? 0,
      stats: userStats,
    },
    gamepass: {
      id, url: order.gamepassUrl, expectedPrice: expected, ...live,
      reusedIn: reused,
    },
    money: {
      saleAmountKopecks: order.saleAmountKopecks,
      purchaseRobuxAmount: order.purchaseRobuxAmount,
      purchaseRateUsdPer1k: order.purchaseRateUsdPer1k ?? order.purchaseRate,
      purchaseUsdToRub: order.purchaseUsdToRub,
      purchaseCostKopecks: order.purchaseCostKopecks,
      profitKopecks: order.profitKopecks,
      payments: order.paymentAttempts,
    },
    fulfillment: {
      purchaserUsername: order.purchaserUsername,
      paidAt: order.paidAt, completedAt: order.completedAt,
    },
    communications: { events: order.events },
    related,
    warnings,
    partialErrors,
  };
}
