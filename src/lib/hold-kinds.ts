/**
 * Причина заморозки — подвкладки «Заморожены» (30.10.2026).
 *
 * Отдельного поля «тип» у заморозки нет и не нужно: кто её поставил
 * (`heldBy`) и с чего начинается причина, однозначно говорят, откуда она.
 * Гейт подписывается «гейт выкупа», автозащита по заявкам/отменам/возвратам —
 * «автозащита», всё остальное поставил человек.
 */
import type { Prisma } from "@prisma/client";
import { BAD_REVIEW_REASON_HEAD, GATE_ACTOR } from "../../bots/shared/buyout-gate";
import { PROBLEM_HOLD_ACTOR } from "../../bots/shared/order-hold";

import { HOLD_KINDS, HOLD_KIND_META, isHoldKind, type HoldKind } from "./hold-kinds-meta";

export { HOLD_KINDS, HOLD_KIND_META, isHoldKind, type HoldKind };

export function holdKindOf(order: { heldBy?: string | null; heldReason?: string | null }): HoldKind {
  if (order.heldBy === GATE_ACTOR) {
    return (order.heldReason ?? "").startsWith(BAD_REVIEW_REASON_HEAD) ? "review" : "stale";
  }
  if (order.heldBy === PROBLEM_HOLD_ACTOR) return "claim";
  return "manual";
}

/** Сужение ленты «Заморожены» до одной причины. */
export function holdKindWhere(kind: HoldKind): Prisma.WbOrderWhereInput {
  switch (kind) {
    case "review": return { heldBy: GATE_ACTOR, heldReason: { startsWith: BAD_REVIEW_REASON_HEAD } };
    case "stale":  return { heldBy: GATE_ACTOR, NOT: { heldReason: { startsWith: BAD_REVIEW_REASON_HEAD } } };
    case "claim":  return { heldBy: PROBLEM_HOLD_ACTOR };
    case "manual": return { OR: [{ heldBy: null }, { heldBy: { notIn: [GATE_ACTOR, PROBLEM_HOLD_ACTOR] } }] };
  }
}

/** Счётчики подвкладок одним запросом. */
export async function countHoldKinds(db: {
  $queryRaw: <T = unknown>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
}): Promise<Record<HoldKind, number>> {
  const rows = await db.$queryRaw<Array<{ heldBy: string | null; review: boolean; n: bigint }>>`
    SELECT "heldBy", COALESCE("heldReason", '') LIKE ${BAD_REVIEW_REASON_HEAD + "%"} AS review, COUNT(*)::bigint AS n
    FROM "WbOrder"
    WHERE "heldAt" IS NOT NULL AND "isTest" = false
    GROUP BY 1, 2`;
  const out: Record<HoldKind, number> = { review: 0, claim: 0, stale: 0, manual: 0 };
  for (const row of rows) {
    const kind = holdKindOf({ heldBy: row.heldBy, heldReason: row.review ? BAD_REVIEW_REASON_HEAD : "" });
    out[kind] += Number(row.n);
  }
  return out;
}
