/** Типы раздела «Риски» и досье покупателя — общие для TWA и /admin. */

export type RiskState = "open" | "all";
export type RiskKind = "BAD_REVIEW" | "REVIEW_FIXED" | "CLAIM_OPENED" | "CLAIM_RESOLVED";

export interface RiskFeedItem {
  id: string;
  kind: RiskKind;
  wbCode: string | null;
  wbOrderId: string | null;
  buyerName: string | null;
  buyerKey: string | null;
  amount: number | null;
  stars: number | null;
  starsBefore: number | null;
  text: string | null;
  /** frozen | released | none */
  action: string | null;
  occurredAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  order: { id: string; status: string; held: boolean } | null;
}

export interface RiskFeed {
  items: RiskFeedItem[];
  summary: { open: number; badReviews7d: number; fixed7d: number; claimsOpen: number };
}

export interface BuyerDossier {
  key: string;
  displayName: string;
  flag: { note: string | null; by: string; at: string } | null;
  stats: { orders: number; completed: number; badReviews: number; claims: number };
  /** На это имя много заказов — скорее всего это разные люди. */
  likelyNamesakes: boolean;
  orders: Array<{
    wbOrderId: string;
    code: string | null;
    orderId: string | null;
    amount: number | null;
    createdAt: string;
    /** Статус нашего заказа; CANCELLED — отменён на WB; NO_ORDER — код не вводили. */
    status: string;
    held: boolean;
    heldReason: string | null;
    claim: boolean;
  }>;
  events: RiskFeedItem[];
}

export const RISK_KIND_META: Record<RiskKind, { label: string; tone: "red" | "green" | "amber" | "muted" }> = {
  BAD_REVIEW:     { label: "Плохой отзыв", tone: "red" },
  REVIEW_FIXED:   { label: "Отзыв исправлен", tone: "green" },
  CLAIM_OPENED:   { label: "Заявка на возврат", tone: "amber" },
  CLAIM_RESOLVED: { label: "Заявка решена", tone: "muted" },
};

export const ORDER_STATUS_RU: Record<string, string> = {
  AWAITING_GAMEPASS: "ждём геймпасс",
  PENDING: "к выкупу",
  IN_PROGRESS: "выкупается",
  COMPLETED: "выкуплен",
  REJECTED: "отменён",
  ERROR: "ошибка выкупа",
  CANCELLED: "отменён на WB",
  NO_ORDER: "код не вводили",
};

/** Что гейт сделал с заказом — подпись в ленте. */
export function riskActionText(action: string | null | undefined): string | null {
  if (action === "frozen") return "заморожен гейтом";
  if (action === "released") return "разморожен гейтом";
  return null;
}
