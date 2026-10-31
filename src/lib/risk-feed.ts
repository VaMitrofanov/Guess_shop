/**
 * Раздел «Риски» и досье покупателя (30.10.2026) — серверная часть.
 *
 * События пишет воркер DBS (`bots/shared/risk-events.ts`); здесь только чтение,
 * отметка «разобрано» и отметка «проблемный покупатель». Каждый ответ — один
 * заход в базу (запросы идут параллельно): база в Сингапуре, а каждое лишнее
 * обращение стоит ~210 мс.
 */
import { prisma } from "@/lib/prisma";
import { buyerKey } from "@/lib/order-risk";
import type { BuyerDossier, RiskFeed, RiskFeedItem, RiskState } from "@/lib/risk-feed-types";

export type { BuyerDossier, RiskFeed, RiskFeedItem, RiskState } from "@/lib/risk-feed-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

/** Тот же ключ, что `normalizeName` в JS: обрезать, схлопнуть пробелы, нижний регистр. */
const NAME_KEY_SQL = `lower(regexp_replace(btrim(m."buyerName"), '\\s+', ' ', 'g'))`;

type RiskRow = {
  id: string; kind: string; wbCode: string | null; wbOrderId: string | null;
  buyerName: string | null; buyerKey: string | null; amount: number | null;
  stars: number | null; starsBefore: number | null; text: string | null; action: string | null;
  occurredAt: Date; resolvedAt: Date | null; resolvedBy: string | null;
  orderId: string | null; orderStatus: string | null; heldAt: Date | null;
};

function toItem(row: RiskRow): RiskFeedItem {
  return {
    id: row.id,
    kind: row.kind as RiskFeedItem["kind"],
    wbCode: row.wbCode,
    wbOrderId: row.wbOrderId,
    buyerName: row.buyerName,
    buyerKey: row.buyerKey,
    amount: row.amount,
    stars: row.stars,
    starsBefore: row.starsBefore,
    text: row.text,
    action: row.action,
    occurredAt: row.occurredAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    resolvedBy: row.resolvedBy,
    order: row.orderId
      ? { id: row.orderId, status: row.orderStatus ?? "", held: Boolean(row.heldAt) }
      : null,
  };
}

const RISK_SELECT = `
  e.id, e.kind, e."wbCode", e."wbOrderId", e."buyerName", e."buyerKey", e.amount,
  e.stars, e."starsBefore", e.text, e.action, e."occurredAt", e."resolvedAt", e."resolvedBy",
  o.id AS "orderId", o.status AS "orderStatus", o."heldAt"
`;

export async function loadRiskFeed(state: RiskState, limit = 80): Promise<RiskFeed> {
  const take = Math.min(200, Math.max(10, limit));
  const where = state === "open" ? `WHERE e."resolvedAt" IS NULL` : "";
  const [rows, summaryRows] = await Promise.all([
    db.$queryRawUnsafe(
      `SELECT ${RISK_SELECT}
       FROM "RiskEvent" e
       LEFT JOIN "WbOrder" o ON o."wbCode" = e."wbCode"
       ${where}
       ORDER BY e."occurredAt" DESC
       LIMIT ${take}`,
    ) as Promise<RiskRow[]>,
    db.$queryRaw`
      SELECT
        COUNT(*) FILTER (WHERE "resolvedAt" IS NULL)::int AS open,
        COUNT(*) FILTER (WHERE kind = 'BAD_REVIEW' AND "occurredAt" > NOW() - INTERVAL '7 days')::int AS "badReviews7d",
        COUNT(*) FILTER (WHERE kind = 'REVIEW_FIXED' AND "occurredAt" > NOW() - INTERVAL '7 days')::int AS "fixed7d",
        COUNT(*) FILTER (WHERE kind = 'CLAIM_OPENED' AND "resolvedAt" IS NULL)::int AS "claimsOpen"
      FROM "RiskEvent"` as Promise<Array<RiskFeed["summary"]>>,
  ]);
  return {
    items: rows.map(toItem),
    summary: summaryRows[0] ?? { open: 0, badReviews7d: 0, fixed7d: 0, claimsOpen: 0 },
  };
}

/** Число открытых событий — для значка в навигации. */
export async function countOpenRisks(): Promise<number> {
  return db.riskEvent.count({ where: { resolvedAt: null } });
}

export async function setRiskResolved(id: string, resolved: boolean, actor: string) {
  return db.riskEvent.update({
    where: { id },
    data: resolved ? { resolvedAt: new Date(), resolvedBy: actor } : { resolvedAt: null, resolvedBy: null },
    select: { id: true, resolvedAt: true, resolvedBy: true },
  });
}

/** Сколько заказов на одно имя считаем «скорее всего один человек». */
const NAMESAKE_HINT_ORDERS = 4;

export async function loadBuyerDossier(rawKey: string): Promise<BuyerDossier | null> {
  const key = buyerKey(rawKey);
  if (!key) return null;
  const [orders, events, flag] = await Promise.all([
    db.$queryRawUnsafe(
      `SELECT m."wbOrderId", m."buyerName", m."nmId", m."denominationSnapshot" AS amount,
              m."createdAt", m."cancelledAt", m."claimOpenedAt",
              w.code, o.id AS "orderId", o.status, o."heldAt", o."heldReason", o."completedAt"
       FROM "WbMarketplaceOrder" m
       LEFT JOIN "WbCode" w ON w.id = m."wbCodeId"
       LEFT JOIN "WbOrder" o ON o."wbCode" = w.code
       WHERE m."isTest" = false AND ${NAME_KEY_SQL} = $1
       ORDER BY m."createdAt" DESC
       LIMIT 50`,
      key,
    ) as Promise<Array<{
      wbOrderId: string; buyerName: string | null; nmId: number | null; amount: number | null;
      createdAt: Date; cancelledAt: Date | null; claimOpenedAt: Date | null;
      code: string | null; orderId: string | null; status: string | null;
      heldAt: Date | null; heldReason: string | null; completedAt: Date | null;
    }>>,
    db.$queryRawUnsafe(
      `SELECT ${RISK_SELECT}
       FROM "RiskEvent" e
       LEFT JOIN "WbOrder" o ON o."wbCode" = e."wbCode"
       WHERE e."buyerKey" = $1
       ORDER BY e."occurredAt" DESC
       LIMIT 60`,
      key,
    ) as Promise<RiskRow[]>,
    db.buyerFlag.findUnique({ where: { buyerKey: key } }),
  ]);

  const displayName = orders.find((o) => o.buyerName)?.buyerName ?? events.find((e) => e.buyerName)?.buyerName ?? rawKey.trim();
  const items = events.map(toItem);
  return {
    key,
    displayName,
    flag: flag ? { note: flag.note, by: flag.createdBy, at: flag.createdAt.toISOString() } : null,
    stats: {
      orders: orders.length,
      completed: orders.filter((o) => o.status === "COMPLETED").length,
      badReviews: new Set(items.filter((e) => e.kind === "BAD_REVIEW").map((e) => e.wbCode)).size,
      claims: items.filter((e) => e.kind === "CLAIM_OPENED").length,
    },
    likelyNamesakes: orders.length >= NAMESAKE_HINT_ORDERS,
    orders: orders.map((o) => ({
      wbOrderId: o.wbOrderId,
      code: o.code,
      orderId: o.orderId,
      amount: o.amount,
      createdAt: o.createdAt.toISOString(),
      status: o.cancelledAt ? "CANCELLED" : o.status ?? "NO_ORDER",
      held: Boolean(o.heldAt),
      heldReason: o.heldReason,
      claim: Boolean(o.claimOpenedAt),
    })),
    events: items,
  };
}

export async function setBuyerFlag(input: { key: string; displayName: string; note: string | null; actor: string; on: boolean }) {
  const key = buyerKey(input.key);
  if (!key) throw new Error("Имя покупателя пустое");
  if (!input.on) {
    await db.buyerFlag.deleteMany({ where: { buyerKey: key } });
    return null;
  }
  const note = input.note?.trim().slice(0, 300) || null;
  const row = await db.buyerFlag.upsert({
    where: { buyerKey: key },
    create: { buyerKey: key, displayName: input.displayName.trim().slice(0, 80) || key, note, createdBy: input.actor },
    update: { note, createdBy: input.actor },
  });
  return { note: row.note, by: row.createdBy, at: row.createdAt.toISOString() };
}
