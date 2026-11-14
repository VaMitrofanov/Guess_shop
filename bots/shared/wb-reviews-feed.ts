/* ─────────────────────────────────────────────────────────────────────────────
   ⭐ Лента отзывов Wildberries для витрины сайта (15.11.2026).

   Правила владельца (docs/storefront-2-plan.md, п. 6):
   - только 5★ и с текстом; имя — первое слово (нет — «Покупатель»);
   - отсекаем преждевременные («надеюсь придут», «пока жду») и любые
     упоминания обмана — даже «не обман»: на витрине это читается плохо;
   - средний балл НЕ показываем; общее число — честное (храним ВСЕ отзывы,
     `eligible` отмечает отобранные);
   - админ может скрыть отзыв (`/review_hide`), скрытие переживает обновления.

   TG-бот раз в час берёт отзывы из feedbacks-api (тот же сбор, что у гейта
   выкупа) и кладёт в `WbReview`; сайт только читает.
   ───────────────────────────────────────────────────────────────────────── */

export interface RawWbFeedback {
  id?: string;
  productValuation?: number;
  userName?: string;
  nmId?: number;
  productDetails?: { nmId?: number };
  createdDate?: string;
  text?: string;
  pros?: string;
  cons?: string;
  childFeedbackId?: string | null;
}

export interface ReviewRow {
  id: string;
  nmId: number | null;
  rating: number;
  text: string;
  authorName: string;
  wbCreatedAt: Date;
  eligible: boolean;
}

const PREMATURE_RE = /(надеюсь|надеемся|пока не|пока жд|ещё не|еще не|жду|ждём|ждем|посмотрим|не пришл|не приш|не получил|не зачисл|обман|мошен|развод|верните|возврат|долго|не сразу)/i;
const CONTACT_RE = /(https?:\/\/|www\.|t\.me|@[a-z0-9_]{3,}|\+?\d[\d\s()-]{8,}\d)/i;
const MIN_TEXT = 15;
const MAX_TEXT = 240;

export function reviewAuthorName(userName: string | undefined): string {
  const first = (userName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first || /^покупател/i.test(first) || first.length > 20 || !/^[\p{L}-]+$/u.test(first)) return "Покупатель";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** Текст отзыва для витрины: основной текст, иначе «достоинства». */
export function reviewText(feedback: RawWbFeedback): string {
  const text = (feedback.text ?? "").trim() || (feedback.pros ?? "").trim();
  const clean = text.replace(/\s+/g, " ");
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1).trimEnd()}…` : clean;
}

export function isShowcaseReview(feedback: RawWbFeedback): boolean {
  if (feedback.productValuation !== 5) return false;
  if (feedback.childFeedbackId) return false; // есть более новая версия отзыва
  const text = reviewText(feedback);
  if (text.length < MIN_TEXT) return false;
  if (PREMATURE_RE.test(text) || CONTACT_RE.test(text)) return false;
  if ((feedback.cons ?? "").trim().length > 0 && PREMATURE_RE.test(feedback.cons ?? "")) return false;
  return true;
}

export function toReviewRow(feedback: RawWbFeedback): ReviewRow | null {
  if (!feedback.id || typeof feedback.productValuation !== "number") return null;
  const created = feedback.createdDate ? new Date(feedback.createdDate) : null;
  if (!created || Number.isNaN(created.getTime())) return null;
  return {
    id: feedback.id,
    nmId: feedback.nmId ?? feedback.productDetails?.nmId ?? null,
    rating: feedback.productValuation,
    text: reviewText(feedback),
    authorName: reviewAuthorName(feedback.userName),
    wbCreatedAt: created,
    eligible: isShowcaseReview(feedback),
  };
}

type ReviewDb = {
  wbReview: {
    upsert(args: {
      where: { id: string };
      create: ReviewRow;
      update: Omit<ReviewRow, "id">;
    }): Promise<unknown>;
  };
};

/** Кладёт отзывы в базу. `hidden` не трогаем — решение админа сильнее обновления. */
export async function storeReviews(db: ReviewDb, feedbacks: RawWbFeedback[]): Promise<{ stored: number; eligible: number }> {
  let stored = 0;
  let eligible = 0;
  for (const feedback of feedbacks) {
    const row = toReviewRow(feedback);
    if (!row) continue;
    const { id, ...rest } = row;
    await db.wbReview.upsert({ where: { id }, create: row, update: rest });
    stored += 1;
    if (row.eligible) eligible += 1;
  }
  return { stored, eligible };
}
