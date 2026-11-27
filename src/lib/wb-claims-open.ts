import { prisma } from "@/lib/prisma";

/* ─────────────────────────────────────────────────────────────────────────────
   ↩ Открытые заявки на возврат WB, которые ждут решения (27.11.2026).

   Источник — пометка «Возврат открыт» (`flags` kind CLAIM без `ackAt`): её
   ставит синк заявок, гасит «✓ Договорились» или ответ на заявку из карточки.
   Выкупленные и отменённые не считаем — решать по ним уже нечего.
   ───────────────────────────────────────────────────────────────────────── */

export interface OpenClaimRow { code: string; amount: number; status: string; reason: string | null; at: string }
export interface OpenClaims { total: number; rows: OpenClaimRow[] }

export async function loadOpenClaims(limit = 5): Promise<OpenClaims> {
  const rows = await prisma.$queryRaw<Array<{ code: string; amount: number; status: string; reason: string | null; at: string; total: bigint }>>`
    SELECT o."wbCode" AS code, o.amount, o.status::text AS status,
           f->>'detail' AS reason, f->>'at' AS at, COUNT(*) OVER () AS total
    FROM "WbOrder" o
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(o.flags::jsonb) = 'array' THEN o.flags::jsonb ELSE '[]'::jsonb END) f
    WHERE f->>'kind' = 'CLAIM' AND f->>'ackAt' IS NULL
      AND o.status NOT IN ('COMPLETED', 'REJECTED') AND o."isTest" = false
      -- WB уже решил заявку (возврат проведён или отказ) — решать нечего.
      AND NOT EXISTS (
        SELECT 1 FROM "WbMarketplaceOrder" m JOIN "WbCode" c ON c.id = m."wbCodeId"
        WHERE c.code = o."wbCode" AND (m."claimResolvedAt" IS NOT NULL OR m."cancelledAt" IS NOT NULL)
      )
    ORDER BY f->>'at' DESC
    LIMIT ${limit}`;
  return {
    total: rows.length ? Number(rows[0].total) : 0,
    rows: rows.map((r) => ({ code: r.code, amount: r.amount, status: r.status, reason: r.reason, at: r.at })),
  };
}
