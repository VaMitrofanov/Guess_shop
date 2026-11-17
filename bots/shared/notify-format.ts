import { escapeHtml } from "./notify";

/**
 * Один язык для всех уведомлений в админку.
 *
 * До этого в TG писали около 25 разных мест, и эмодзи у каждого были свои:
 * 📦 🔑 🤖 ✅ ⚠️ 🚫 💬 🔷 📥. По сообщению нельзя было понять главное — нужно
 * что-то делать прямо сейчас или это просто отчёт работающей автоматики.
 *
 * 02.09.2026 язык распространён на ВСЕ push-уведомления админам, а не только на
 * DBS: владелец прислал скрин, где подряд идут карточка активации, алерт об
 * упавшем боте и карточка выкупа — три разных заголовка, три набора эмодзи, ни
 * одного общего ключа. Экраны админ-хаба (`bots/tg/admin/*`) сюда НЕ входят:
 * это не поток входящих, а интерфейс, который админ открывает сам.
 *
 * Правило одно: **значок кодирует срочность и больше ничего.** Тему несёт
 * зона, факты — строки, а «что дальше» — отдельная строка, потому что именно
 * её человек ищет в первую очередь.
 */

export type NoticeMarker =
  /** Автоматика работает, промежуточный этап. Делать нечего. */
  | "progress"
  /** Мяч на стороне клиента. Делать нечего, но ждём. */
  | "waiting"
  /** Требуется ручное действие. */
  | "action"
  /** Деньги или невосполнимый дедлайн под угрозой. */
  | "urgent"
  /** Этап закрыт успешно. */
  | "done"
  /** Заказ умер: отмена, возврат, отказ. */
  | "cancelled"
  /** Только «покупатель пишет»: заказ ещё не начат, мяч у покупателя (17.11.2026). */
  | "idle";

const MARKER: Record<NoticeMarker, string> = {
  progress: "🔵",
  waiting: "🟡",
  action: "🟠",
  urgent: "🔴",
  done: "🟢",
  cancelled: "⚫️",
  idle: "⚪️",
};

/** Продуктовая область. Позволяет отфильтровать глазами за долю секунды. */
type NoticeZone =
  | "DBS" | "ПРЯМОЙ" | "WB" | "САЙТ" | "ВЫКУП" | "ОТЗЫВ" | "ПОДДЕРЖКА" | "СИСТЕМА";

export type AdminNotice = {
  marker: NoticeMarker;
  zone: NoticeZone;
  /** Что произошло — в настоящем времени, без «уведомление о том, что…». */
  title: string;
  /** Факты: заказ, суммы, имена. Пустые строки отбрасываются. */
  lines?: Array<string | null | undefined | false>;
  /**
   * Что произойдёт дальше само или что сделать человеку. Единственная строка,
   * которую читают на бегу, поэтому она всегда последняя и всегда одна.
   */
  next?: string | null;
};

/**
 * Собирает сообщение. HTML внутри `title`/`lines`/`next` НЕ экранируется —
 * вызывающая сторона сама решает, где `<b>` и `<code>`, и сама экранирует
 * пользовательские данные через `escapeHtml`.
 */
export function formatAdminNotice(notice: AdminNotice): string {
  const head = `${MARKER[notice.marker]} <b>${notice.zone} · ${notice.title}</b>`;
  const body = (notice.lines ?? []).filter((line): line is string => Boolean(line));
  // 15.11.2026, владелец: «убери „Дальше:“ везде — мы и так знаем, что делать».
  // Исключение — 🔴 срочные: там в `next` лежит суть (почему заморожен заказ,
  // как продлить токен), она остаётся строкой, но без слова «Дальше».
  const tail = notice.marker === "urgent" && notice.next ? [`👉 ${notice.next}`] : [];
  return [head, ...body, ...tail].join("\n");
}

/**
 * Единая шапка заказа: одна строка, один порядок полей, во всех сообщениях.
 *
 * До этого об одном заказе приходило три сообщения с тремя разными первыми
 * строками: живая карточка DBS и сообщение покупателя знали номер WB, а
 * карточка входа на сайт — только код гейта. Общего ключа не было ни одного,
 * и связать их глазом было нечем (скрин владельца, 01.09.2026).
 *
 * Теперь ключей всегда два — номер заказа WB и код гейта, — и стоят они в
 * одном и том же месте. Код в `<code>`: тап по нему копирует.
 */
type OrderRefParts = {
  wbOrderId?: string | null;
  /** Код гейта (он же код ВБ): ZZF7T5B. */
  code?: string | null;
  denomination?: number | null;
  priceKopecks?: number | null;
  buyerName?: string | null;
};

export function orderRef(
  parts: OrderRefParts,
  extra?: Array<string | null | undefined | false>,
): string {
  return [
    parts.wbOrderId ? `WB #${escapeHtml(parts.wbOrderId)}` : null,
    parts.code ? `<code>${escapeHtml(parts.code)}</code>` : null,
    denomLine(parts.denomination, parts.priceKopecks),
    parts.buyerName ? escapeHtml(parts.buyerName) : null,
    ...(extra ?? []),
  ].filter((part): part is string => Boolean(part)).join(" · ");
}

/** Номинал в одном формате во всех сообщениях. 15.11.2026, владелец: рубли из
 *  шапки убраны — «номер WB оставить, остальное убирай»; цена есть в карточке. */
function denomLine(denomination: number | null | undefined, _priceKopecks?: number | null): string | null {
  return denomination ? `<b>${denomination.toLocaleString("ru-RU")} R$</b>` : null;
}

const ORDER_STATUS_WORDS: Record<string, string> = {
  AWAITING_PAYMENT:  "ждёт оплаты",
  PAYMENT_PENDING:   "оплата в обработке",
  AWAITING_GAMEPASS: "ждёт ссылку на геймпасс",
  PENDING:           "в очереди на выкуп",
  IN_PROGRESS:       "выкупается",
  COMPLETED:         "выкуплен",
  REJECTED:          "отклонён",
  ERROR:             "ошибка выкупа",
};

/** Статус заказа человеческим языком; незнакомый показываем как есть. */
export function orderStatusWord(status: string): string {
  return ORDER_STATUS_WORDS[status] ?? status;
}

/** Время по Москве — единственная зона, в которой владелец читает сообщения. */
export function mskTime(date: Date): string {
  return date.toLocaleTimeString("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * «❄️ заморожен: причина» — единая строка заморозки для уведомлений (17.11.2026).
 *
 * Голое «❄️ заморожен» скрывало главное: VTJV24S пришёл в «покупатель пишет»
 * с «Всё сделал, проверяйте», а причина — «Возврат на WB одобрен, деньги уходят
 * покупателю». Без неё заказ выглядит как «забыли разморозить». Причина
 * экранируется и режется до `max` символов; пустая — «причина не указана».
 */
export function heldLabel(reason: string | null | undefined, max = 90): string {
  const why = (reason ?? "").replace(/\s+/g, " ").trim();
  const short = why.length > max ? `${why.slice(0, max - 1).trimEnd()}…` : why;
  return `❄️ заморожен: ${short ? escapeHtml(short) : "причина не указана"}`;
}
