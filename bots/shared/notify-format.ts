import { escapeHtml } from "./notify";

/**
 * Один язык для всех уведомлений в админку.
 *
 * До этого в TG писали около 25 разных мест, и эмодзи у каждого были свои:
 * 📦 🔑 🤖 ✅ ⚠️ 🚫 💬 🔷 📥. По сообщению нельзя было понять главное — нужно
 * что-то делать прямо сейчас или это просто отчёт работающей автоматики.
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
  | "cancelled";

const MARKER: Record<NoticeMarker, string> = {
  progress: "🔵",
  waiting: "🟡",
  action: "🟠",
  urgent: "🔴",
  done: "🟢",
  cancelled: "⚫️",
};

/** Продуктовая область. Позволяет отфильтровать глазами за долю секунды. */
export type NoticeZone = "DBS" | "ПРЯМОЙ" | "WB" | "САЙТ" | "ВЫКУП" | "ОТЗЫВ" | "СИСТЕМА";

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
  const tail = notice.next ? [`Дальше: ${notice.next}`] : [];
  return [head, ...body, ...tail].join("\n");
}

/** Ярлык «WB #12345» одной строкой — самый частый первый факт в зоне DBS. */
export function wbOrderRef(wbOrderId: string, extra?: Array<string | null | undefined | false>): string {
  const parts = [`WB #${escapeHtml(wbOrderId)}`, ...(extra ?? []).filter((p): p is string => Boolean(p))];
  return parts.join(" · ");
}

/** Деньги и номинал в одном формате во всех сообщениях. */
export function denomLine(denomination: number | null | undefined, priceKopecks?: number | null): string | null {
  const parts: string[] = [];
  if (denomination) parts.push(`<b>${denomination.toLocaleString("ru-RU")} R$</b>`);
  if (priceKopecks) parts.push(`${Math.round(priceKopecks / 100).toLocaleString("ru-RU")} ₽`);
  return parts.length ? parts.join(" · ") : null;
}

/** Время по Москве — единственная зона, в которой владелец читает сообщения. */
export function mskTime(date: Date): string {
  return date.toLocaleTimeString("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  });
}
