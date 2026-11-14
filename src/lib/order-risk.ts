/**
 * Отзыв и покупатель для карточки заказа (30.10.2026).
 *
 * Плашка отзыва (★1 «текст», или ★1 → ★5) и строка покупателя с отметкой
 * «проблемный». Берётся одним запросом на пачку кодов и одним — на все отметки
 * (их единицы), оба параллельно: к загрузке карточек это не добавляет захода в
 * базу, если звать вместе с остальной обвязкой.
 */
import { normalizeName } from "../../bots/shared/buyout-gate";
import type { OrderRisk } from "./order-risk-types";

export type { OrderRisk } from "./order-risk-types";

type Db = {
  $queryRaw: <T = unknown>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
  buyerFlag: { findMany: (args: unknown) => Promise<Array<{ buyerKey: string; note: string | null; createdBy: string; createdAt: Date }>> };
};

export function buyerKey(name: string | null | undefined): string | null {
  const key = normalizeName(name);
  return key.length >= 2 ? key : null;
}

export async function riskInfoForCodes(db: Db, codes: string[]): Promise<Map<string, OrderRisk>> {
  const unique = [...new Set(codes.filter(Boolean))];
  const out = new Map<string, OrderRisk>();
  if (unique.length === 0) return out;
  const [rows, flags] = await Promise.all([
    db.$queryRaw<Array<{
      code: string; buyerName: string | null; wbOrderId: string | null;
      kind: string | null; stars: number | null; starsBefore: number | null;
      text: string | null; occurredAt: Date | null; action: string | null;
      total: number | null; idx: number | null;
      sibs: Array<{ code: string | null; nick: string | null; status: string | null; cancelled: boolean }> | null;
    }>>`
      SELECT c.code, m."buyerName", m."wbOrderId",
             r.kind, r.stars, r."starsBefore", r.text, r."occurredAt", r.action,
             b.total, b.idx, b.sibs
      FROM unnest(${unique}::text[]) AS c(code)
      LEFT JOIN "WbCode" w ON w.code = c.code
      LEFT JOIN "WbMarketplaceOrder" m ON m."wbCodeId" = w.id
      -- 🧺 Корзина WB: соседние заказы той же покупки (общий orderUid), по порядку WB.
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE length(s."wbOrderId") < length(m."wbOrderId")
                 OR (length(s."wbOrderId") = length(m."wbOrderId") AND s."wbOrderId" <= m."wbOrderId"))::int AS idx,
               json_agg(json_build_object('code', sw.code, 'nick', so."robloxUsername", 'status', so.status,
                 'cancelled', s."cancelledAt" IS NOT NULL) ORDER BY length(s."wbOrderId"), s."wbOrderId") AS sibs
        FROM "WbMarketplaceOrder" s
        LEFT JOIN "WbCode" sw ON sw.id = s."wbCodeId"
        LEFT JOIN "WbOrder" so ON so."wbCode" = sw.code
        WHERE m."orderUid" IS NOT NULL AND s."orderUid" = m."orderUid"
      ) b ON true
      LEFT JOIN LATERAL (
        SELECT e.kind, e.stars, e."starsBefore", e.text, e."occurredAt", e.action
        FROM "RiskEvent" e
        WHERE e."wbCode" = c.code AND e.kind IN ('BAD_REVIEW', 'REVIEW_FIXED', 'REVIEW_DELETED')
        ORDER BY e."occurredAt" DESC
        LIMIT 1
      ) r ON true`,
    db.buyerFlag.findMany({ select: { buyerKey: true, note: true, createdBy: true, createdAt: true }, take: 1000 }),
  ]);
  const flagByKey = new Map(flags.map((f) => [f.buyerKey, f]));
  for (const row of rows) {
    const key = buyerKey(row.buyerName);
    const flag = key ? flagByKey.get(key) : undefined;
    const basket = row.total && row.total > 1 && row.idx
      ? { index: row.idx, total: row.total, siblings: row.sibs ?? [] }
      : null;
    if (!row.buyerName && !row.kind && !basket) continue;
    out.set(row.code, {
      buyerName: row.buyerName,
      buyerKey: key,
      wbOrderId: row.wbOrderId,
      flag: flag ? { note: flag.note, by: flag.createdBy, at: flag.createdAt.toISOString() } : null,
      review: row.kind === "BAD_REVIEW" || row.kind === "REVIEW_FIXED" || row.kind === "REVIEW_DELETED"
        ? {
            kind: row.kind,
            stars: row.stars,
            starsBefore: row.starsBefore,
            text: row.text,
            at: (row.occurredAt ?? new Date()).toISOString(),
            action: row.action,
          }
        : null,
      basket,
    });
  }
  return out;
}
