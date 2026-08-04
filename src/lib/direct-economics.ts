import { prisma } from "@/lib/prisma";
import { DIRECT_PRICES } from "@/lib/retail-pricing";
import {
  DIRECT_ECONOMICS_SOURCES,
  type BonusSource, type DirectEconomics, type DirectEconomicsSource,
  type EconomicsOrder, type RevenueSource,
} from "@/lib/economics-model";

export type { DirectEconomics, DirectEconomicsSource, EconomicsOrder } from "@/lib/economics-model";

/* ─────────────────────────────────────────────────────────────────────────────
   Экономика не-WB заказов («прямые»): DIRECT (бот/TWA), SITE, AVITO, MANUAL.
   WB-коридор сюда не входит — там платит WB, и выручки заказа в базе нет.

   Модуль отдаёт СЫРЫЕ строки, а не посчитанный профит: курс доллара, ставку
   закупа и комиссию Roblox админ крутит прямо в экране, и пересчёт обязан быть
   мгновенным. Формула — чистые функции внизу файла, общие для TWA и веба:
   одна поверхность не должна считать прибыль иначе, чем другая.

   Единственная арифметика при загрузке — восстановление того, чего в заказе
   нет:
   1. `saleAmountKopecks` появился позже первых прямых заказов → у ранних он
      NULL. Берём цену из заявки (`DirectIntent.rublePrice`), из которой заказ
      и был создан; она уже net рублёвой скидки (`bots/vk/handlers.ts:2510`).
   2. `bonusAppliedRobux` исторически писал только TG-путь. Порядок источников:
      поле заказа → журнал бонусов → заявка.

   Каждая строка несёт `revenueSource` / `bonusSource`, чтобы экран честно
   показывал, где цифра из снапшота, а где восстановлена.
   ───────────────────────────────────────────────────────────────────────── */

// Берём newest-first и одну дополнительную строку, чтобы честно сообщить UI,
// что история продолжается. Старый asc+take оставлял в выборке самые старые
// 2000 строк и после роста молча скрывал новые финансовые операции.
const MAX_ORDERS = 2000;

export async function loadDirectEconomics(): Promise<DirectEconomics> {
  const fetchedOrders = await prisma.wbOrder.findMany({
    where: { isTest: false, status: "COMPLETED", orderSource: { in: [...DIRECT_ECONOMICS_SOURCES] } },
    select: {
      id: true, wbCode: true, orderSource: true, platform: true, userId: true,
      amount: true, robloxUsername: true,
      saleAmountKopecks: true, purchaseCostKopecks: true,
      purchaseRobuxAmount: true, purchaseRateUsdPer1k: true, purchaseUsdToRub: true,
      bonusAppliedRobux: true, paidAt: true, createdAt: true, completedAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_ORDERS + 1,
  });
  const truncated = fetchedOrders.length > MAX_ORDERS;
  const orders = fetchedOrders.slice(0, MAX_ORDERS);

  const orderIds = orders.map((o) => o.id);
  const userIds = [...new Set(orders.map((o) => o.userId))];

  const [ledger, intents, settings] = await Promise.all([
    prisma.bonusLedger.findMany({
      where: { referenceId: { in: orderIds }, deltaRobux: { lt: 0 } },
      select: { referenceId: true, deltaRobux: true },
    }),
    prisma.directIntent.findMany({
      where: { userId: { in: userIds }, status: "CONSUMED" },
      select: { id: true, userId: true, totalAmount: true, bonus: true, rublePrice: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.globalSettings.findUnique({
      where: { id: "global" },
      select: { purchaseRate: true, usdToRub: true },
    }),
  ]);

  const spentByOrder = new Map<string, number>();
  for (const row of ledger) {
    if (!row.referenceId) continue;
    spentByOrder.set(row.referenceId, (spentByOrder.get(row.referenceId) ?? 0) - row.deltaRobux);
  }

  const intentsByUser = new Map<string, typeof intents>();
  for (const intent of intents) {
    const list = intentsByUser.get(intent.userId) ?? [];
    list.push(intent);
    intentsByUser.set(intent.userId, list);
  }

  // Заявка «сгорает» после привязки: два заказа одного размера у одного юзера
  // не должны обе взять одну и ту же заявку и удвоить восстановленную выручку.
  const claimed = new Set<string>();
  const matchIntent = (userId: string, amount: number, createdAt: Date) => {
    const list = intentsByUser.get(userId);
    if (!list) return null;
    let best: (typeof intents)[number] | null = null;
    for (const intent of list) {
      if (claimed.has(intent.id)) continue;
      if (intent.totalAmount !== amount) continue;
      if (intent.createdAt > createdAt) continue;
      if (!best || intent.createdAt > best.createdAt) best = intent;
    }
    if (best) claimed.add(best.id);
    return best;
  };

  const rows: EconomicsOrder[] = orders.map((o) => {
    const intent = matchIntent(o.userId, o.amount, o.createdAt);

    let revenueKopecks: number | null = o.saleAmountKopecks;
    let revenueSource: RevenueSource = "order";
    if (revenueKopecks == null) {
      revenueKopecks = intent ? intent.rublePrice * 100 : null;
      revenueSource = intent ? "intent" : "unknown";
    }

    const ledgerBonus = spentByOrder.get(o.id) ?? 0;
    let bonusRobux = 0;
    let bonusSource: BonusSource = "none";
    if (o.bonusAppliedRobux != null) {
      bonusRobux = o.bonusAppliedRobux;
      bonusSource = "order";
    } else if (ledgerBonus > 0) {
      bonusRobux = ledgerBonus;
      bonusSource = "ledger";
    } else if (intent) {
      bonusRobux = intent.bonus;
      bonusSource = "intent";
    }

    return {
      id: o.id,
      wbCode: o.wbCode,
      source: o.orderSource as DirectEconomicsSource,
      platform: o.platform,
      robloxUsername: o.robloxUsername,
      robuxDelivered: o.amount,
      bonusRobux,
      bonusSource,
      revenueKopecks,
      revenueSource,
      costSnapshotKopecks: o.purchaseCostKopecks,
      grossSnapshotRobux: o.purchaseRobuxAmount,
      rateSnapshotUsdPer1k: o.purchaseRateUsdPer1k,
      usdToRubSnapshot: o.purchaseUsdToRub,
      paid: o.paidAt != null,
      createdAt: o.createdAt.toISOString(),
      completedAt: o.completedAt?.toISOString() ?? null,
    };
  });

  return {
    orders: rows,
    // Стартовые значения интерактивной формулы. Это то, чем сейчас считаются
    // снапшоты выкупа (`buildOrderProfitSnapshot`), а не «правильный» курс:
    // если закупаем дороже, цифры в экране разойдутся со снапшотами — экран
    // показывает это расхождение отдельной плашкой.
    defaults: {
      usdToRub: settings?.usdToRub ?? 90,
      purchaseRateUsdPer1k: settings?.purchaseRate ?? null,
      robloxTaxPct: 30,
    },
    prices: DIRECT_PRICES,
    truncated,
  };
}
