import type { PrismaClient } from "@prisma/client";
import { fetchWbSales, type WbSaleRow } from "./wb-delivery-api";
import { holdForProblem } from "./order-hold";
import { buyerKeyOf, recordRiskEvents, type RiskEventInput } from "./risk-events";

/* ─────────────────────────────────────────────────────────────────────────────
   Сверка денег WB с выдачей (12.11.2026).

   Статусы DBS врут или замирают: старый заказ WB перестаёт обновлять через
   неделю, второй заказ корзины стоял «закрыт» без кода три недели, и никто об
   этом не знал. Деньги же видны всегда — в статистике продаж: `S…` — продажа,
   `R…` — возврат, `A…`/`B…` — их сторно.

   Раз в три часа берём продажи за 40 дней и сравниваем с нашими заказами по
   `srid` (это тот же `rid`, что у DBS-заказа). Находка — событие в «Рисках»
   (видно в TWA и в /admin, и в досье покупателя) и один пуш админам:

   • SALE_UNMATCHED — WB продал нашу карточку, а заказа у нас нет вовсе;
   • SALE_NO_CODE   — заказ оплачен и не возвращён, а код покупателю не выдан;
   • REFUND_OPEN    — деньги вернулись, а наш заказ ещё не выкуплен → заморозка
                      «деньги ушли» (правило владельца), выкупать нельзя;
   • REFUND_AFTER_DELIVERY — деньги вернулись после выкупа: робуксы ушли,
                      оплаты нет. Сделать можно только руками (спор с WB).
   ───────────────────────────────────────────────────────────────────────── */

type Db = PrismaClient;

const STREAM = "wb-sales-reconcile";
/** Как часто ходим в статистику: данные WB обновляются раз в ~30 минут. */
export const RECONCILE_EVERY_MS = 3 * 60 * 60_000;
const LOOKBACK_MS = 40 * 24 * 60 * 60_000;
/** Продажа моложе этого — заказ ещё может синхронизироваться / получить код. */
const SALE_GRACE_MS = 2 * 60 * 60_000;

export type SaleMoney = {
  srid: string;
  nmId: number | null;
  /** Чистые продажи: S минус сторно A. */
  sold: number;
  /** Чистые возвраты: R минус сторно B. */
  refunded: number;
  soldAt: Date | null;
  refundedAt: Date | null;
  refundId: string | null;
  amountRub: number | null;
  /** Продажа со склада продавца (наш DBS). Склад WB — физическая карта с
   * напечатанным кодом: заказа DBS у неё не бывает, это не потеря. */
  sellerWarehouse: boolean;
};

function parseWbDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  // Статистика отдаёт московское время без зоны.
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}+03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Строки статистики → деньги по каждому заказу (`srid`). */
export function moneyBySrid(rows: WbSaleRow[], nmIds?: Set<number>): Map<string, SaleMoney> {
  const out = new Map<string, SaleMoney>();
  for (const row of rows) {
    if (!row.srid || !row.saleID) continue;
    if (nmIds && (row.nmId == null || !nmIds.has(row.nmId))) continue;
    const m = out.get(row.srid) ?? {
      srid: row.srid, nmId: row.nmId ?? null, sold: 0, refunded: 0,
      soldAt: null, refundedAt: null, refundId: null, amountRub: null, sellerWarehouse: false,
    };
    if (row.warehouseType === "Склад продавца") m.sellerWarehouse = true;
    const at = parseWbDate(row.date);
    switch (row.saleID[0]) {
      case "S":
        m.sold += 1;
        m.soldAt = m.soldAt && at && m.soldAt < at ? m.soldAt : at ?? m.soldAt;
        if (row.priceWithDisc != null) m.amountRub = row.priceWithDisc;
        break;
      case "A": m.sold -= 1; break;
      case "R":
        m.refunded += 1;
        if (at && (!m.refundedAt || at > m.refundedAt)) { m.refundedAt = at; m.refundId = row.saleID; }
        break;
      case "B": m.refunded -= 1; break;
      default: break;
    }
    out.set(row.srid, m);
  }
  return out;
}

export type ReconcileOrder = {
  id: string;
  rid: string;
  wbOrderId: string;
  buyerName: string | null;
  nmId: number;
  denomination: number | null;
  code: string | null;
  cancelledAt: Date | null;
  internalStatus: string | null;
};

export type ReconcileFinding =
  | { kind: "SALE_UNMATCHED"; money: SaleMoney }
  | { kind: "SALE_NO_CODE"; money: SaleMoney; order: ReconcileOrder }
  | { kind: "REFUND_OPEN"; money: SaleMoney; order: ReconcileOrder }
  | { kind: "REFUND_AFTER_DELIVERY"; money: SaleMoney; order: ReconcileOrder };

const OPEN_STATUSES = new Set(["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR"]);

/** Правило сверки — без базы и сети, ради тестов. */
export function classifySales(
  money: Map<string, SaleMoney>,
  orders: Map<string, ReconcileOrder>,
  now: Date,
): ReconcileFinding[] {
  const out: ReconcileFinding[] = [];
  for (const m of money.values()) {
    const order = orders.get(m.srid);
    const refunded = m.refunded > 0;
    const settled = m.sold > 0 && !refunded;
    const old = m.soldAt ? now.getTime() - m.soldAt.getTime() > SALE_GRACE_MS : false;
    if (!order) {
      if (settled && old && m.sellerWarehouse) out.push({ kind: "SALE_UNMATCHED", money: m });
      continue;
    }
    if (order.denomination == null) continue; // не карточка коридора (800code и т.п.)
    if (settled && old && !order.code && !order.cancelledAt) {
      out.push({ kind: "SALE_NO_CODE", money: m, order });
    }
    // Отмену WB (`cancelledAt`) уже ловит старая защита; здесь — возврат, о
    // котором статус DBS промолчал.
    if (refunded && order.code && !order.cancelledAt) {
      if (order.internalStatus === "COMPLETED") out.push({ kind: "REFUND_AFTER_DELIVERY", money: m, order });
      else if (order.internalStatus == null || OPEN_STATUSES.has(order.internalStatus)) {
        out.push({ kind: "REFUND_OPEN", money: m, order });
      }
    }
  }
  return out;
}

function riskEventFor(f: ReconcileFinding, now: Date): RiskEventInput {
  const order = "order" in f ? f.order : null;
  const rub = f.money.amountRub != null ? `${Math.round(f.money.amountRub)} ₽` : null;
  const text = {
    SALE_UNMATCHED: `WB продал карточку (srid ${f.money.srid}${rub ? `, ${rub}` : ""}), а заказа DBS у нас нет`,
    SALE_NO_CODE: "Оплачено и не возвращено, а код покупателю не выдан",
    REFUND_OPEN: `Деньги вернулись покупателю (${f.money.refundId ?? "возврат"}), заказ не выкуплен — заморожен`,
    REFUND_AFTER_DELIVERY: `Деньги вернулись покупателю (${f.money.refundId ?? "возврат"}) ПОСЛЕ выкупа`,
  }[f.kind];
  return {
    kind: f.kind,
    dedupeKey: `reconcile:${f.kind}:${f.money.srid}`,
    wbCode: order?.code ?? null,
    wbOrderId: order?.wbOrderId ?? null,
    buyerName: order?.buyerName ?? null,
    buyerKey: buyerKeyOf(order?.buyerName),
    nmId: order?.nmId ?? f.money.nmId,
    amount: order?.denomination ?? null,
    text,
    action: f.kind === "REFUND_OPEN" ? "frozen" : "none",
    occurredAt: (f.kind.startsWith("REFUND") ? f.money.refundedAt : f.money.soldAt) ?? now,
  };
}

export type ReconcileResult = { skipped: true } | {
  skipped: false;
  sales: number;
  fresh: ReconcileFinding[];
  open: Record<ReconcileFinding["kind"], number>;
};

/**
 * Один проход сверки. `force` — мимо трёхчасового интервала (ручной запуск).
 * Новые находки возвращаются вызывающему — он решает, как сказать админам.
 */
export async function runWbSalesReconcile(db: Db, opts: { now?: Date; force?: boolean } = {}): Promise<ReconcileResult> {
  const now = opts.now ?? new Date();
  const cursor = await db.wbSyncCursor.findUnique({ where: { stream: STREAM } }).catch(() => null);
  if (!opts.force && cursor?.lastAttemptAt && now.getTime() - cursor.lastAttemptAt.getTime() < RECONCILE_EVERY_MS) {
    return { skipped: true };
  }
  await db.wbSyncCursor.upsert({
    where: { stream: STREAM },
    create: { stream: STREAM, lastAttemptAt: now },
    update: { lastAttemptAt: now },
  });

  const nmRows = await db.wbMarketplaceOrder.findMany({
    where: { isTest: false, denominationSnapshot: { not: null } },
    distinct: ["nmId"],
    select: { nmId: true },
  });
  const nmIds = new Set(nmRows.map((r) => r.nmId));
  let rows: WbSaleRow[];
  try {
    rows = await fetchWbSales(new Date(now.getTime() - LOOKBACK_MS));
  } catch (error) {
    await db.wbSyncCursor.update({ where: { stream: STREAM }, data: { lastErrorCode: String((error as Error)?.message ?? error).slice(0, 120) } });
    throw error;
  }
  const money = moneyBySrid(rows, nmIds);

  const marketplace = await db.wbMarketplaceOrder.findMany({
    where: { rid: { in: [...money.keys()] } },
    select: {
      id: true, rid: true, wbOrderId: true, buyerName: true, nmId: true,
      denominationSnapshot: true, cancelledAt: true, wbCode: { select: { code: true } },
    },
  });
  const codes = marketplace.flatMap((m) => (m.wbCode?.code ? [m.wbCode.code] : []));
  const internal = await db.wbOrder.findMany({ where: { wbCode: { in: codes } }, select: { wbCode: true, status: true } });
  const statusByCode = new Map(internal.map((o) => [o.wbCode, String(o.status)]));
  const orders = new Map<string, ReconcileOrder>();
  for (const m of marketplace) {
    if (!m.rid) continue;
    const code = m.wbCode?.code ?? null;
    orders.set(m.rid, {
      id: m.id, rid: m.rid, wbOrderId: m.wbOrderId, buyerName: m.buyerName, nmId: m.nmId,
      denomination: m.denominationSnapshot, code, cancelledAt: m.cancelledAt,
      internalStatus: code ? statusByCode.get(code) ?? null : null,
    });
  }

  const findings = classifySales(money, orders, now);

  // «Деньги ушли» — не выкупать. holdForProblem идемпотентна и уважает ручную разморозку.
  for (const f of findings) {
    if (f.kind !== "REFUND_OPEN" || !f.order.code) continue;
    await holdForProblem(db, {
      wbCode: f.order.code,
      kind: "WB_CANCELLED",
      detail: `возврат денег по статистике WB ${f.money.refundId ?? ""}`.trim(),
      eventAt: f.money.refundedAt,
    }).catch((e) => console.error(`[wb-reconcile] заморозка ${f.order.code} не удалась:`, e));
  }

  // Новые — только те, чьих событий ещё не было: пуш один раз на находку.
  const events = findings.map((f) => riskEventFor(f, now));
  const known = new Set((await db.riskEvent.findMany({
    where: { dedupeKey: { in: events.map((e) => e.dedupeKey) } },
    select: { dedupeKey: true },
  })).map((e) => e.dedupeKey));
  const fresh = findings.filter((_, i) => !known.has(events[i].dedupeKey));
  await recordRiskEvents(db, events.filter((e) => !known.has(e.dedupeKey)));

  // Находки, которых больше нет (код выдали, заказ появился, возврат сторнирован), — разобраны.
  const stillOpen = new Set(events.map((e) => e.dedupeKey));
  await db.riskEvent.updateMany({
    where: {
      resolvedAt: null,
      kind: { in: ["SALE_UNMATCHED", "SALE_NO_CODE", "REFUND_OPEN"] },
      dedupeKey: { notIn: [...stillOpen] },
    },
    data: { resolvedAt: now, resolvedBy: "авто: сверка WB сошлась" },
  });

  const open = { SALE_UNMATCHED: 0, SALE_NO_CODE: 0, REFUND_OPEN: 0, REFUND_AFTER_DELIVERY: 0 };
  for (const f of findings) open[f.kind] += 1;
  await db.wbSyncCursor.update({
    where: { stream: STREAM },
    data: { lastSuccessAt: now, lastErrorCode: null, metadata: { sales: money.size, ...open } },
  });
  return { skipped: false, sales: money.size, fresh, open };
}

const FINDING_LABEL: Record<ReconcileFinding["kind"], string> = {
  SALE_UNMATCHED: "продажа без заказа у нас",
  SALE_NO_CODE: "оплачен, код не выдан",
  REFUND_OPEN: "деньги вернулись — заморожен, не выкупать",
  REFUND_AFTER_DELIVERY: "деньги вернулись после выкупа",
};

/** Строка находки для пуша админам (HTML уже экранирован вызывающим `escape`). */
export function reconcileNoticeLine(f: ReconcileFinding, escape: (s: string) => string): string {
  const order = "order" in f ? f.order : null;
  const who = order
    ? [order.code ? `<code>${escape(order.code)}</code>` : null, `WB ${escape(order.wbOrderId)}`,
      order.buyerName ? escape(order.buyerName) : null, order.denomination ? `${order.denomination} R$` : null]
    : [`srid ${escape(f.money.srid)}`, f.money.nmId ? `арт. ${f.money.nmId}` : null];
  return `${FINDING_LABEL[f.kind]}: ${who.filter(Boolean).join(" · ")}`;
}
