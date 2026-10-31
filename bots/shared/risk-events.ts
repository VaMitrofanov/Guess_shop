/* ─────────────────────────────────────────────────────────────────────────────
   События риска (30.10.2026): лента раздела «Риски» и история досье покупателя.

   Что считается событием:
   • BAD_REVIEW     — актуальная версия отзыва покупателя ★1–3;
   • REVIEW_FIXED   — отзыв был ★1–3, стал ★4–5;
   • CLAIM_OPENED   — покупатель открыл заявку на возврат;
   • CLAIM_RESOLVED — WB решил заявку.

   Пишет только свип гейта (раз в 15 минут) — один источник, без гонок между
   ботами. `dedupeKey` делает запись идемпотентной: свип может видеть одно и то
   же сколько угодно раз.

   «Открыто» = нужен человек. Всё, где делать нечего (заказ уже выкуплен,
   закрыт или отменён; отзыв исправлен), рождается или становится разобранным
   автоматически — иначе лента превратилась бы в архив, а не в список дел.
   ───────────────────────────────────────────────────────────────────────── */

import { normalizeName, type FixedReview, type WbFeedback } from "./buyout-gate";

export type RiskKind = "BAD_REVIEW" | "REVIEW_FIXED" | "CLAIM_OPENED" | "CLAIM_RESOLVED";
export type RiskAction = "frozen" | "released" | "none";

export const RISK_AUTO_ACTOR = "авто";

export interface RiskEventInput {
  kind: RiskKind;
  dedupeKey: string;
  wbCode: string | null;
  wbOrderId: string | null;
  buyerName: string | null;
  buyerKey: string | null;
  nmId: number | null;
  amount: number | null;
  stars?: number | null;
  starsBefore?: number | null;
  text?: string | null;
  feedbackId?: string | null;
  action?: RiskAction | null;
  occurredAt: Date;
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
}

/** DBS-заказ в том виде, который нужен ленте. */
export interface RiskOrder {
  marketplaceId: string;
  wbCode: string | null;
  wbOrderId: string;
  buyerName: string | null;
  nmId: number | null;
  amount: number | null;
  createdAt: Date;
  /** Наш заказ выкуплен, закрыт или WB его отменил — делать больше нечего. */
  closed: boolean;
  claimOpenedAt: Date | null;
  claimReason: string | null;
  claimResolvedAt: Date | null;
  /** WB вернул деньги (заказ отменён после заявки). */
  refunded: boolean;
}

/** Ключ досье: имя покупателя без регистра и лишних пробелов. */
export function buyerKeyOf(name: string | null | undefined): string | null {
  const key = normalizeName(name);
  return key.length >= 2 ? key : null;
}

/** Текст отзыва целиком: у WB он бывает разложен на «достоинства/недостатки». */
export function reviewText(review: WbFeedback): string | null {
  const parts = [review.text, review.pros ? `+ ${review.pros}` : null, review.cons ? `− ${review.cons}` : null]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  const joined = parts.join("\n");
  return joined ? joined.slice(0, 1000) : null;
}

function reviewDate(review: WbFeedback, fallback: Date): Date {
  const t = review.createdDate ? Date.parse(review.createdDate) : NaN;
  return Number.isFinite(t) ? new Date(t) : fallback;
}

function base(order: RiskOrder) {
  return {
    wbCode: order.wbCode,
    wbOrderId: order.wbOrderId,
    buyerName: order.buyerName,
    buyerKey: buyerKeyOf(order.buyerName),
    nmId: order.nmId,
    amount: order.amount,
  };
}

/** Событие закрытого заказа сразу «разобрано»: решать там уже нечего. */
function autoResolved(order: RiskOrder, now: Date, why: string) {
  return order.closed ? { resolvedAt: now, resolvedBy: `${RISK_AUTO_ACTOR}: ${why}` } : {};
}

export function badReviewEvent(order: RiskOrder, review: WbFeedback, action: RiskAction, now: Date): RiskEventInput {
  return {
    kind: "BAD_REVIEW",
    dedupeKey: `bad:${order.marketplaceId}:${review.id ?? reviewDate(review, now).toISOString()}`,
    ...base(order),
    stars: Number(review.productValuation ?? 0),
    text: reviewText(review),
    feedbackId: review.id ?? null,
    action,
    occurredAt: reviewDate(review, now),
    ...autoResolved(order, now, "заказ закрыт"),
  };
}

export function reviewFixedEvent(order: RiskOrder, fixed: FixedReview, action: RiskAction, now: Date): RiskEventInput {
  return {
    kind: "REVIEW_FIXED",
    dedupeKey: `fixed:${order.marketplaceId}:${fixed.review.id ?? reviewDate(fixed.review, now).toISOString()}`,
    ...base(order),
    stars: Number(fixed.review.productValuation ?? 0),
    starsBefore: Number(fixed.was.productValuation ?? 0),
    text: reviewText(fixed.review),
    feedbackId: fixed.review.id ?? null,
    action,
    occurredAt: reviewDate(fixed.review, now),
    // Исправление — хорошая новость: гейт уже сам снял свой замок, если он был.
    resolvedAt: now,
    resolvedBy: `${RISK_AUTO_ACTOR}: отзыв исправлен`,
  };
}

export function claimEvents(order: RiskOrder, now: Date): RiskEventInput[] {
  const out: RiskEventInput[] = [];
  if (order.claimOpenedAt) {
    out.push({
      kind: "CLAIM_OPENED",
      dedupeKey: `claim:${order.marketplaceId}`,
      ...base(order),
      text: order.claimReason?.slice(0, 1000) ?? null,
      occurredAt: order.claimOpenedAt,
      ...autoResolved(order, now, order.refunded ? "деньги вернули" : "заказ закрыт"),
    });
  }
  if (order.claimResolvedAt) {
    out.push({
      kind: "CLAIM_RESOLVED",
      dedupeKey: `claim-resolved:${order.marketplaceId}`,
      ...base(order),
      text: order.refunded ? "решена в пользу покупателя — деньги вернули" : "решена в пользу продавца",
      occurredAt: order.claimResolvedAt,
      resolvedAt: now,
      resolvedBy: `${RISK_AUTO_ACTOR}: решение WB`,
    });
  }
  return out;
}

/**
 * Отзыв тёзки на старый заказ — шум, а не риск: для ленты берём отзыв, оставленный
 * не позже чем через 30 дней после заказа. Гейт (замок на деньги) это окно не
 * сужает: там лучше перестраховаться.
 */
export const RISK_REVIEW_MAX_DAYS_AFTER_ORDER = 30;

export function reviewBelongsInFeed(order: RiskOrder, review: WbFeedback): boolean {
  const t = review.createdDate ? Date.parse(review.createdDate) : NaN;
  if (!Number.isFinite(t)) return true;
  return t - order.createdAt.getTime() <= RISK_REVIEW_MAX_DAYS_AFTER_ORDER * 86_400_000;
}

/* ─── База ───────────────────────────────────────────────────────────────── */

// Клиент Prisma у ботов и у сайта разный по типам — модуль принимает утиный.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Записать события; повтор того же `dedupeKey` молча пропускается. */
export async function recordRiskEvents(db: Db, events: RiskEventInput[]): Promise<number> {
  if (events.length === 0) return 0;
  const res = await db.riskEvent.createMany({ data: events, skipDuplicates: true });
  return Number(res?.count ?? 0);
}

/**
 * Разобрать открытые события, по которым делать больше нечего:
 * заказ закрыт или отзыв исправлен (тогда — только плохие отзывы этого кода).
 */
export async function autoResolveRiskEvents(
  db: Db,
  input: { closedCodes: string[]; fixedCodes: string[]; now?: Date },
): Promise<number> {
  const now = input.now ?? new Date();
  let total = 0;
  if (input.closedCodes.length > 0) {
    const res = await db.riskEvent.updateMany({
      where: { resolvedAt: null, wbCode: { in: input.closedCodes } },
      data: { resolvedAt: now, resolvedBy: `${RISK_AUTO_ACTOR}: заказ закрыт` },
    });
    total += Number(res?.count ?? 0);
  }
  if (input.fixedCodes.length > 0) {
    const res = await db.riskEvent.updateMany({
      where: { resolvedAt: null, kind: "BAD_REVIEW", wbCode: { in: input.fixedCodes } },
      data: { resolvedAt: now, resolvedBy: `${RISK_AUTO_ACTOR}: отзыв исправлен` },
    });
    total += Number(res?.count ?? 0);
  }
  return total;
}
