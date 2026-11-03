/** Типы раздела «Риски» и досье покупателя — общие для TWA и /admin. */

export type RiskState = "open" | "all";
export type RiskKind =
  | "BAD_REVIEW" | "REVIEW_FIXED" | "CLAIM_OPENED" | "CLAIM_RESOLVED"
  /** Из обращений покупателя (01.11.2026, `bots/shared/buyer-contact-sweep.ts`). */
  | "BUYER_CANCEL" | "BUYER_HELP";

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

/**
 * Что показывает раздел «Риски» и досье (02.11.2026): только то, что сделал сам
 * покупатель на WB, — плохой отзыв и заявка на возврат. Обращения из чатов
 * («хочу отменить», «нужен человек») сюда не попадают: стоп по «верните деньги»
 * виден в «Первым делом», а сами записи BUYER_* остаются в базе как метка
 * «это сообщение уже обработано» для `buyer-contact-sweep`.
 */
export const RISK_FEED_KINDS: readonly RiskKind[] = ["BAD_REVIEW", "REVIEW_FIXED", "CLAIM_OPENED", "CLAIM_RESOLVED"];
export const RISK_FEED_KINDS_SQL = RISK_FEED_KINDS.map((k) => `'${k}'`).join(", ");

export const RISK_KIND_META: Record<RiskKind, { label: string; tone: "red" | "green" | "amber" | "muted" }> = {
  BAD_REVIEW:     { label: "Плохой отзыв", tone: "red" },
  REVIEW_FIXED:   { label: "Отзыв исправлен", tone: "green" },
  CLAIM_OPENED:   { label: "Заявка на возврат", tone: "amber" },
  CLAIM_RESOLVED: { label: "Заявка решена", tone: "muted" },
  BUYER_CANCEL:   { label: "Просит отмену", tone: "red" },
  BUYER_HELP:     { label: "Нужен человек", tone: "amber" },
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

/** Что автоматика сделала с заказом — подпись в ленте. */
export function riskActionText(action: string | null | undefined, kind?: string | null): string | null {
  if (kind === "BUYER_CANCEL") return action === "frozen" ? "заморожен: просьба об отмене" : null;
  if (action === "frozen") return "заморожен гейтом";
  if (action === "released") return "разморожен гейтом";
  return null;
}
