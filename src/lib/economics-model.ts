import { directPrice } from "@/lib/retail-pricing";

/* ─────────────────────────────────────────────────────────────────────────────
   Модель экономики не-WB заказов: типы и чистые функции расчёта.

   Отдельный модуль от загрузчика (`direct-economics.ts`) специально: тот тянет
   Prisma, а эти функции нужны в браузере — и в TWA-экране, и в веб-админке.
   Импорт загрузчика из клиентского компонента утащил бы Prisma в бандл.

   Одна формула на обе поверхности: экран в телефоне и экран в вебе не должны
   расходиться в том, сколько мы заработали.
   ───────────────────────────────────────────────────────────────────────── */

export const DIRECT_ECONOMICS_SOURCES = ["DIRECT", "SITE", "AVITO", "MANUAL"] as const;
export type DirectEconomicsSource = (typeof DIRECT_ECONOMICS_SOURCES)[number];

export type RevenueSource = "order" | "intent" | "unknown";
export type BonusSource = "order" | "ledger" | "intent" | "none";

export interface EconomicsOrder {
  id: string;
  wbCode: string;
  source: DirectEconomicsSource;
  platform: string;
  robloxUsername: string | null;
  /** Сколько R$ реально получил клиент — включая бонусные. */
  robuxDelivered: number;
  bonusRobux: number;
  bonusSource: BonusSource;
  /** Сколько клиент заплатил, ₽ в копейках (уже за вычетом рублёвой скидки). */
  revenueKopecks: number | null;
  revenueSource: RevenueSource;
  /** Снапшоты на момент выкупа — для сверки с текущей моделью. */
  costSnapshotKopecks: number | null;
  grossSnapshotRobux: number | null;
  rateSnapshotUsdPer1k: number | null;
  usdToRubSnapshot: number | null;
  paid: boolean;
  createdAt: string;
  completedAt: string | null;
}

export interface DirectEconomics {
  orders: EconomicsOrder[];
  defaults: { usdToRub: number; purchaseRateUsdPer1k: number | null; robloxTaxPct: number };
  prices: Record<string, number>;
  truncated: boolean;
}

/* ── Модель: чистые функции, общие для TWA и веб-админки ──────────────────── */

/** Режим УСН: от базы зависит, с чего берётся налог. */
export type UsnMode = "income" | "income-minus-expenses";

/**
 * Стартовые ставки платёжного контура.
 *
 * Владелец 30.07 зафиксировал консервативную ставку обычной оплаты 3.49% и
 * УСН «Доходы» 6%. Отдельные 1.5% «Чеков» не включаются без подтверждения,
 * что платный сервис действительно активен в кабинете Т-Банка.
 */
export const DEFAULT_FEE_RATES = {
  acquiringPct: 3.49,
  receiptPct: 0,
  usnPct: 6,
  usnMode: "income" as UsnMode,
};

export interface EconomicsRates {
  /** ₽ за 1 $. */
  usdToRub: number;
  /** $ за 1000 грязных R$. */
  rateUsdPer1k: number;
  /** Комиссия Roblox за геймпасс, %. */
  taxPct: number;
  /** Комиссия интернет-эквайринга, % от платежа. */
  acquiringPct: number;
  /** Сервис «Чеки» Т-Банка, % от платежа с чеком (docs/payments-and-kkt.md). */
  receiptPct: number;
  /** Ставка УСН, %. */
  usnPct: number;
  /** «Доходы» — налог с выручки; «Доходы − расходы» — с прибыли до налога. */
  usnMode: UsnMode;
}

export const ratesValid = (r: EconomicsRates): boolean =>
  r.usdToRub > 0 && r.rateUsdPer1k > 0 && r.taxPct >= 0 && r.taxPct < 100 &&
  r.acquiringPct >= 0 && r.acquiringPct < 100 &&
  r.receiptPct >= 0 && r.receiptPct < 100 &&
  r.usnPct >= 0 && r.usnPct < 100;

/** Цена геймпасса: чтобы клиент получил `net`, купить надо больше на комиссию. */
export const grossFor = (net: number, r: EconomicsRates): number =>
  ratesValid(r) && net > 0 ? Math.ceil(net / (1 - r.taxPct / 100)) : 0;

/** Во сколько ₽ (в копейках) обошлись `gross` грязных робуксов. */
export const costKopFor = (gross: number, r: EconomicsRates): number =>
  ratesValid(r) ? Math.round((gross / 1000) * r.rateUsdPer1k * r.usdToRub * 100) : 0;

/**
 * Цена по прайсу, ₽ в копейках. Нестандартные объёмы — по той же лесенке, что
 * и в боте (`bots/shared/retail-pricing.ts`), иначе «модель» разошлась бы с
 * реальностью на кастомных суммах.
 */
export function modelPriceKop(netRobux: number, prices: Record<number, number>): number {
  if (netRobux <= 0) return 0;
  const listed = prices[netRobux];
  if (listed !== undefined) return listed * 100;
  return directPrice(netRobux) * 100;
}

export interface ComputedOrder {
  order: EconomicsOrder;
  /** Робуксы, оплаченные деньгами (выдано минус бонус). */
  paidRobux: number;
  gross: number;
  costKop: number;
  /** Во что обошёлся бонус: «купить с бонусом» минус «купить без». */
  bonusCostKop: number;
  /** Эквайринг + «Чеки», ₽ в копейках. */
  acquiringKop: number;
  /** Налог УСН, ₽ в копейках. */
  usnKop: number;
  /** Выручка − робуксы (без комиссий и налога). Историческая «грязная» маржа. */
  grossProfitKop: number | null;
  /** Выручка − робуксы − эквайринг − налог. Это и есть «на руки». */
  profitKop: number | null;
  modelRevenueKop: number;
  modelProfitKop: number;
}

/** Комиссии платёжного контура с суммы платежа. */
export const acquiringKopFor = (revenueKop: number, r: EconomicsRates): number =>
  ratesValid(r) ? Math.round((revenueKop * (r.acquiringPct + r.receiptPct)) / 100) : 0;

/**
 * Налог УСН. При «Доходы» база — вся выручка; при «Доходы − расходы» — то, что
 * осталось после робуксов и комиссий, и отрицательная база налога не создаёт.
 */
export function usnKopFor(revenueKop: number, expensesKop: number, r: EconomicsRates): number {
  if (!ratesValid(r)) return 0;
  const base = r.usnMode === "income" ? revenueKop : Math.max(0, revenueKop - expensesKop);
  return Math.round((base * r.usnPct) / 100);
}

export function computeOrder(
  order: EconomicsOrder,
  rates: EconomicsRates,
  prices: Record<number, number>,
): ComputedOrder {
  const paidRobux = Math.max(0, order.robuxDelivered - order.bonusRobux);
  const gross = grossFor(order.robuxDelivered, rates);
  const costKop = costKopFor(gross, rates);
  const bonusCostKop = costKop - costKopFor(grossFor(paidRobux, rates), rates);
  const modelRevenueKop = modelPriceKop(paidRobux, prices);
  const revenueKop = order.revenueKopecks;

  const acquiringKop = revenueKop != null ? acquiringKopFor(revenueKop, rates) : 0;
  const usnKop = revenueKop != null ? usnKopFor(revenueKop, costKop + acquiringKop, rates) : 0;

  const modelAcquiringKop = acquiringKopFor(modelRevenueKop, rates);
  const modelUsnKop = usnKopFor(modelRevenueKop, costKop + modelAcquiringKop, rates);

  return {
    order,
    paidRobux,
    gross,
    costKop,
    bonusCostKop,
    acquiringKop,
    usnKop,
    grossProfitKop: revenueKop != null ? revenueKop - costKop : null,
    profitKop: revenueKop != null ? revenueKop - costKop - acquiringKop - usnKop : null,
    modelRevenueKop,
    modelProfitKop: modelRevenueKop - costKop - modelAcquiringKop - modelUsnKop,
  };
}

export interface EconomicsTotals {
  orders: number;
  withRevenue: number;
  revenueKop: number;
  costKop: number;
  /** Себестоимость заказов, по которым выручка неизвестна. */
  costNoRevenueKop: number;
  /** Себестоимость только тех заказов, что попали в прибыль. */
  knownCostKop: number;
  profitKop: number;
  marginPct: number | null;
  delivered: number;
  bonus: number;
  paidRobux: number;
  gross: number;
  bonusCostKop: number;
  /** Эквайринг + «Чеки» по всем заказам с известной выручкой. */
  acquiringKop: number;
  /** Налог УСН по всем заказам с известной выручкой. */
  usnKop: number;
  /** Выручка − робуксы, до комиссий и налога. */
  grossProfitKop: number;
  modelRevenueKop: number;
  modelProfitKop: number;
  snapshotCostKop: number;
  snapshotCount: number;
}

/**
 * Прибыль считается только по заказам с известной выручкой: иначе
 * себестоимость «бесплатных» заказов молча съела бы маржу остальных.
 */
export function computeTotals(rows: ComputedOrder[]): EconomicsTotals {
  const t: EconomicsTotals = {
    orders: rows.length, withRevenue: 0, revenueKop: 0, costKop: 0, costNoRevenueKop: 0,
    knownCostKop: 0, profitKop: 0, marginPct: null, delivered: 0, bonus: 0, paidRobux: 0,
    gross: 0, bonusCostKop: 0, acquiringKop: 0, usnKop: 0, grossProfitKop: 0,
    modelRevenueKop: 0, modelProfitKop: 0, snapshotCostKop: 0, snapshotCount: 0,
  };
  for (const r of rows) {
    t.delivered += r.order.robuxDelivered;
    t.bonus += r.order.bonusRobux;
    t.paidRobux += r.paidRobux;
    t.gross += r.gross;
    t.costKop += r.costKop;
    t.bonusCostKop += r.bonusCostKop;
    t.modelRevenueKop += r.modelRevenueKop;
    if (r.order.revenueKopecks != null) {
      t.withRevenue += 1;
      t.revenueKop += r.order.revenueKopecks;
      t.acquiringKop += r.acquiringKop;
      t.usnKop += r.usnKop;
    } else {
      t.costNoRevenueKop += r.costKop;
    }
    if (r.order.costSnapshotKopecks != null) {
      t.snapshotCount += 1;
      t.snapshotCostKop += r.order.costSnapshotKopecks;
    }
  }
  t.knownCostKop = t.costKop - t.costNoRevenueKop;
  t.grossProfitKop = t.revenueKop - t.knownCostKop;
  t.profitKop = t.grossProfitKop - t.acquiringKop - t.usnKop;
  t.marginPct = t.revenueKop > 0 ? Math.round((t.profitKop / t.revenueKop) * 100) : null;
  t.modelProfitKop = t.modelRevenueKop - t.costKop;
  return t;
}
