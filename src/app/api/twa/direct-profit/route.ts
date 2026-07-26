import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";

/* ─────────────────────────────────────────────────────────────────────────────
   Заработок по НЕ-WB каналам («прямые заказы»): DIRECT (бот/TWA), SITE (сайт),
   AVITO, MANUAL. WB-коридор сюда не входит: там выручка приходит от WB, а не
   от клиента, и в `WbOrder` её нет.

   ВАЖНО (v1, 2026-07-25): считаем ровно по денежным снапшотам заказа —
   `saleAmountKopecks` (сколько заплатил клиент), `purchaseCostKopecks`
   (сколько стоил выкуп), `profitKopecks` (маржа на момент выкупа). Эти поля
   заполняются далеко не у всех заказов, поэтому ответ всегда несёт
   `coverage`: сколько выполненных заказов реально попало в деньги. Пока
   coverage низкий, цифрам верить нельзя — экран это показывает явно.
   Дозаполнение истории — отдельная задача (см. docs/twa-admin.md).
   ───────────────────────────────────────────────────────────────────────── */

const DIRECT_SOURCES = ["DIRECT", "SITE", "AVITO", "MANUAL"] as const;
type DirectSource = (typeof DIRECT_SOURCES)[number];

// Хвост истории режем, чтобы роут не деградировал с ростом заказов: считаем по
// последним N выполненным не-WB заказам (сейчас их десятки).
const MAX_ORDERS = 5000;

interface ChannelStat {
  source: DirectSource;
  orders: number;
  ordersWithMoney: number;
  revenueKopecks: number;
  costKopecks: number;
  profitKopecks: number;
}

const emptyChannel = (source: DirectSource): ChannelStat => ({
  source, orders: 0, ordersWithMoney: 0, revenueKopecks: 0, costKopecks: 0, profitKopecks: 0,
});

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  // U11: тем же чеком проходим по остальным роутам с периодом — мусорный
  // параметр обязан давать 400, а не падение или молчаливый «весь период».
  const rawDays = url.searchParams.get("days") ?? "0";
  if (!/^\d{1,4}$/.test(rawDays)) {
    return NextResponse.json({ error: "Invalid days" }, { status: 400 });
  }
  const days = Number(rawDays);
  const since = Number.isFinite(days) && days > 0
    ? new Date(Date.now() - days * 86_400_000)
    : null;

  const orders = await prisma.wbOrder.findMany({
    where: {
      isTest: false,
      status: "COMPLETED",
      orderSource: { in: [...DIRECT_SOURCES] },
      ...(since ? { OR: [{ completedAt: { gte: since } }, { completedAt: null, updatedAt: { gte: since } }] } : {}),
    },
    select: {
      orderSource: true, amount: true,
      saleAmountKopecks: true, purchaseCostKopecks: true, profitKopecks: true,
      completedAt: true, createdAt: true,
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    take: MAX_ORDERS,
  });

  const channels = new Map<DirectSource, ChannelStat>(
    DIRECT_SOURCES.map((source) => [source, emptyChannel(source)]),
  );
  let robuxSold = 0;

  for (const order of orders) {
    const stat = channels.get(order.orderSource as DirectSource);
    if (!stat) continue;
    stat.orders += 1;
    robuxSold += order.amount;

    const revenue = order.saleAmountKopecks;
    const cost = order.purchaseCostKopecks;
    // profitKopecks — снапшот на момент выкупа, он главный. Если его нет, но есть
    // обе стороны сделки, считаем маржу сами; иначе заказ «без денег».
    const profit = order.profitKopecks ?? (revenue != null && cost != null ? revenue - cost : null);
    if (profit == null) continue;

    stat.ordersWithMoney += 1;
    stat.revenueKopecks += revenue ?? 0;
    stat.costKopecks += cost ?? 0;
    stat.profitKopecks += profit;
  }

  const list = [...channels.values()].filter((c) => c.orders > 0);
  const totals = list.reduce((acc, c) => ({
    orders: acc.orders + c.orders,
    ordersWithMoney: acc.ordersWithMoney + c.ordersWithMoney,
    revenueKopecks: acc.revenueKopecks + c.revenueKopecks,
    costKopecks: acc.costKopecks + c.costKopecks,
    profitKopecks: acc.profitKopecks + c.profitKopecks,
  }), { orders: 0, ordersWithMoney: 0, revenueKopecks: 0, costKopecks: 0, profitKopecks: 0 });

  const marginPct = totals.revenueKopecks > 0
    ? Math.round((totals.profitKopecks / totals.revenueKopecks) * 100)
    : null;

  return NextResponse.json({
    period: since ? { days, from: since.toISOString() } : { days: 0, from: null },
    totals: {
      ...totals,
      robuxSold,
      marginPct,
      avgProfitKopecks: totals.ordersWithMoney > 0
        ? Math.round(totals.profitKopecks / totals.ordersWithMoney)
        : 0,
    },
    channels: list.sort((a, b) => b.profitKopecks - a.profitKopecks || b.orders - a.orders),
    coverage: {
      completedOrders: totals.orders,
      withMoney: totals.ordersWithMoney,
      missingMoney: totals.orders - totals.ordersWithMoney,
      pct: totals.orders > 0 ? Math.round((totals.ordersWithMoney / totals.orders) * 100) : 0,
    },
    truncated: orders.length === MAX_ORDERS,
  });
}
