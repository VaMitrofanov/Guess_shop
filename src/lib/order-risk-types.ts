/** Типы для клиента: карточка заказа читает их и в TWA, и в /admin. */
export interface OrderRisk {
  buyerName: string | null;
  buyerKey: string | null;
  wbOrderId: string | null;
  /** Отметка «проблемный покупатель». */
  flag: { note: string | null; by: string; at: string } | null;
  /** Последнее событие по отзыву этого заказа. */
  review: {
    kind: "BAD_REVIEW" | "REVIEW_FIXED";
    stars: number | null;
    starsBefore: number | null;
    text: string | null;
    at: string;
    action: string | null;
  } | null;
}

export function starsText(n: number | null | undefined): string {
  const v = Math.max(0, Math.min(5, Math.round(Number(n ?? 0))));
  return "★".repeat(v) + "☆".repeat(5 - v);
}
