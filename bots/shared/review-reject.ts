/**
 * Причины отказа по скриншоту отзыва (карточка «ОТЗЫВ» в админ-чате TG).
 *
 * До 28.10.2026 причин было три (нечёткий / не опубликован / не тот товар),
 * и всё остальное админ объяснял покупателю отдельно руками. Теперь список
 * шире, а для редкого случая есть «✏️ Своя причина» — следующее сообщение
 * админа уходит покупателю как причина.
 *
 * `key` живёт в callback_data (`rr:<orderId>:<userId>:<key>`): CUID×2 = 50
 * байт, лимит Telegram 64 — ключ не длиннее 8 символов (тест).
 */

export interface ReviewRejectReason {
  key: string;
  /** Кнопка в админ-чате. */
  button: string;
  /** Что увидит покупатель после «Скриншот не подошёл: …». */
  reason: string;
}

export const REVIEW_REJECT_REASONS: readonly ReviewRejectReason[] = [
  { key: "blur", button: "📸 Скриншот нечёткий", reason: "скриншот нечёткий или обрезан — текст отзыва не читается" },
  { key: "notpub", button: "⏳ Отзыв ещё не опубликован", reason: "отзыв ещё не опубликован — WB проверяет его до суток, пришли скрин после публикации" },
  { key: "wrong", button: "📦 Не тот товар", reason: "отзыв оставлен не на наш товар — нужен отзыв на карту Roblox от RobloxBank" },
  { key: "notrev", button: "🖼 Это не отзыв", reason: "на скриншоте не отзыв — нужен экран с твоим опубликованным отзывом" },
  { key: "stars", button: "⭐ Не видно оценки", reason: "на скриншоте не видно оценки и текста отзыва — сделай скрин целиком" },
  { key: "dup", button: "🔁 Скрин уже присылали", reason: "этот скриншот уже присылали к другому заказу — нужен скрин твоего отзыва" },
  { key: "acc", button: "👤 Чужой аккаунт WB", reason: "отзыв оставлен с другого аккаунта WB — нужен отзыв того, кто покупал карту" },
] as const;

/** Свой текст админа: без разметки Telegram и не длиннее разумного. */
export const REVIEW_REJECT_CUSTOM_MAX = 500;

export function reviewRejectReasonText(key: string): string | null {
  return REVIEW_REJECT_REASONS.find((r) => r.key === key)?.reason ?? null;
}

/** HTML-экранирование для `parse_mode: "HTML"`: причина может прийти от админа. */
export function escapeReviewReason(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Свой текст: обрезаем пробелы и длину. Пустой — `null`. */
export function normalizeCustomReviewReason(raw: string): string | null {
  const text = raw.trim().replace(/\s+\n/g, "\n").slice(0, REVIEW_REJECT_CUSTOM_MAX);
  return text.length > 0 ? text : null;
}
