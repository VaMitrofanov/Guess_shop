/**
 * Лента заказа и блок «Сейчас» (11.11.2026).
 *
 * Владелец: заметки и состояние (заморозка, возврат, отзыв) «выглядят отдельно
 * от заказа, а должны быть его частью», и «слишком много визуального мусора».
 * Отсюда три вещи, общие для TWA и сайта:
 *  • `orderNow` — один блок сверху: можно ли выкупать, почему и что сделать;
 *  • `orderFeed` — одна хроника: заметки людей, заморозки, заявки, правки;
 *  • `orderHeadline` / `orderStateWord` — строка под ником и слово состояния
 *    в очереди.
 * Новых таблиц нет: хроника собирается из `adminNote` (строки с метками
 * `[ЗАМОРОЗКА …]`, `[EDIT …]`, `[ЗАМЕТКА …]`) и пометок `flags`.
 */

import { FLAG_META, flagLabel, flagsOf, type OrderFlagKind } from "../../bots/shared/order-flags";
import type { Tone } from "./order-presentation";

/** Метка заметки человека из поля «Добавить заметку». */
const NOTE_TAG = "ЗАМЕТКА";

export interface FeedOrder {
  adminNote?: string | null;
  heldAt?: string | Date | null;
  heldReason?: string | null;
  heldBy?: string | null;
  manualReleaseAt?: string | Date | null;
  manualReleaseBy?: string | null;
  flags?: unknown;
  createdAt?: string | Date | null;
}

interface FeedEntry {
  key: string;
  text: string;
  /** Слова покупателя — единственное, что выделяется в ленте. */
  quote?: string | null;
  meta?: string | null;
  /** `strong` — заметка человека и события, требующие решения; `dim` — служебное. */
  weight: "strong" | "dim";
  ts: number;
}

interface OrderNow {
  tone: Tone;
  title: string | null;
  sub?: string | null;
  quote?: string | null;
  action?: { kind: "unhold" } | { kind: "ack"; flag: OrderFlagKind };
  actionLabel?: string;
  note?: { text: string; meta: string | null } | null;
}

/* ── Разбор строк заметки ───────────────────────────────────────────────── */

interface NoteRow { tag: string | null; head: string | null; text: string; who: string | null; ts: number | null }

function parseStamp(tag: string, now: Date): number | null {
  const iso = tag.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3], 9);
  const ru = tag.match(/(\d{2})\.(\d{2})(?:\.(\d{4}))?(?:,?\s*(\d{2}):(\d{2}))?/);
  if (!ru) return null;
  let year = ru[3] ? +ru[3] : now.getUTCFullYear();
  // Время в заметке — московское (UTC+3).
  const at = (y: number) => Date.UTC(y, +ru[2] - 1, +ru[1], ru[4] ? +ru[4] - 3 : 9, ru[5] ? +ru[5] : 0);
  if (!ru[3] && at(year) > now.getTime() + 86_400_000) year -= 1;
  return at(year);
}

function parseRows(note: string | null | undefined, now: Date): NoteRow[] {
  if (!note) return [];
  return note.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const close = line.startsWith("[") ? line.indexOf("]") : -1;
    if (close === -1) return { tag: null, head: null, text: line, who: null, ts: null };
    const tag = line.slice(1, close).trim();
    const head = tag.split(/[\s,]/)[0]?.toUpperCase() ?? null;
    const who = tag.match(/·\s*([^·]+)$/)?.[1]?.trim() ?? tag.match(/(?:^|\s)от\s+(.+)$/)?.[1]?.trim() ?? null;
    return { tag, head, text: line.slice(close + 1).trim(), who, ts: parseStamp(tag, now) };
  });
}

const DAY = 86_400_000;
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** «10:40», «вчера», «5 ноя» — коротко, как в мессенджере. */
export function feedWhen(ts: number | null | undefined, now = Date.now()): string | null {
  if (ts == null || !Number.isFinite(ts)) return null;
  const MSK = 3 * 3600_000;
  const days = Math.floor((now + MSK) / DAY) - Math.floor((ts + MSK) / DAY);
  const a = new Date(ts + MSK);
  if (days <= 0) return `${String(a.getUTCHours()).padStart(2, "0")}:${String(a.getUTCMinutes()).padStart(2, "0")}`;
  if (days === 1) return "вчера";
  return `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}`;
}

const meta = (who: string | null | undefined, ts: number | null | undefined, now: number) =>
  [who, feedWhen(ts, now)].filter(Boolean).join(" · ") || null;

/** Последняя заметка человека: `[ЗАМЕТКА …]`, иначе старая строка без метки. */
export function orderNote(order: FeedOrder, now = Date.now()): { text: string; meta: string | null } | null {
  const rows = parseRows(order.adminNote, new Date(now));
  const tagged = rows.find((r) => r.head === NOTE_TAG && r.text);
  if (tagged) return { text: tagged.text, meta: meta(tagged.who, tagged.ts, now) };
  const plain = rows.find((r) => r.tag === null);
  return plain ? { text: plain.text, meta: null } : null;
}

/* ── Хроника ────────────────────────────────────────────────────────────── */

const HEAD_TEXT: Record<string, (t: string) => string> = {
  "ЗАМОРОЗКА": (t) => `Заморожен: ${t}`,
  "РАЗМОРОЗКА": (t) => (t.includes("вручную") ? "Разморожен вручную" : "Разморожен"),
  "EDIT": (t) => `Правка: ${t}`,
  "НИК?": (t) => `Вероятный ник: ${t}`,
};

export function orderFeed(order: FeedOrder, now = Date.now()): FeedEntry[] {
  const rows = parseRows(order.adminNote, new Date(now));
  const out: FeedEntry[] = [];
  // Строки заметки идут свежими сверху; у строки без даты — время соседа сверху.
  let carry = Number.POSITIVE_INFINITY;
  rows.forEach((r, i) => {
    const ts = r.ts ?? carry;
    carry = ts;
    const human = r.tag === null || r.head === NOTE_TAG;
    const text = human ? r.text : (HEAD_TEXT[r.head ?? ""]?.(r.text) ?? (r.text ? `${r.tag?.split(/\s/)[0]}: ${r.text}` : r.tag ?? ""));
    if (!text) return;
    out.push({
      key: `n${i}`,
      text,
      meta: meta(r.who, Number.isFinite(ts) ? ts : null, now),
      weight: human || r.head === "ЗАМОРОЗКА" ? "strong" : "dim",
      ts,
    });
  });
  for (const f of flagsOf(order)) {
    const at = Date.parse(f.at);
    const m = FLAG_META[f.kind];
    out.push({
      key: `f-${f.kind}`,
      text: f.kind === "CLAIM" ? "Открыт возврат на WB" : f.kind === "STALE" ? "Висит без выкупа" : m.label,
      quote: f.detail ?? null,
      meta: meta(null, at, now),
      weight: "strong",
      ts: at,
    });
    if (f.ackAt) {
      const ack = Date.parse(f.ackAt);
      out.push({ key: `a-${f.kind}`, text: `${m.label} — договорились`, meta: meta(f.ackBy, ack, now), weight: "strong", ts: ack });
    }
  }
  return out.sort((a, b) => b.ts - a.ts);
}

/* ── «Сейчас» ───────────────────────────────────────────────────────────── */

export function orderNow(order: FeedOrder, now = Date.now()): OrderNow | null {
  const note = orderNote(order, now);
  const flags = flagsOf(order);
  const open = flags.filter((f) => !f.ackAt);
  if (order.heldAt) {
    return {
      tone: "ice", title: "Заморожен — не выкупать", sub: order.heldReason ?? "причина не указана",
      action: { kind: "unhold" }, actionLabel: "Разморозить", note,
    };
  }
  if (open.length > 0) {
    const f = open[0];
    const rest = open.length - 1;
    return {
      tone: FLAG_META[f.kind].tone,
      title: flagLabel(f, order, now).replace(/^\S+\s/, ""),
      sub: rest > 0 ? `и ещё ${rest} · выкупать можно после решения` : "выкупать можно после решения",
      quote: f.detail ?? null,
      action: { kind: "ack", flag: f.kind }, actionLabel: "Договорились",
      note,
    };
  }
  const acked = flags.filter((f) => f.ackAt).sort((a, b) => Date.parse(b.ackAt!) - Date.parse(a.ackAt!))[0];
  if (acked) {
    return {
      tone: "green", title: "Можно выкупать",
      sub: `${FLAG_META[acked.kind].label.toLowerCase()} · договорились${acked.ackBy ? `, ${acked.ackBy}` : ""}`,
      note,
    };
  }
  if (order.manualReleaseAt) {
    return { tone: "green", title: "Можно выкупать", sub: `разморожен вручную${order.manualReleaseBy ? `, ${order.manualReleaseBy}` : ""}`, note };
  }
  return note ? { tone: "muted", title: null, note } : null;
}

/** Строка под ником в очереди: заметка человека, иначе слова покупателя. */
export function orderHeadline(order: FeedOrder, now = Date.now()): string | null {
  const note = orderNote(order, now);
  if (note) return note.text;
  const open = flagsOf(order).find((f) => !f.ackAt && f.detail);
  return open?.detail ? `«${open.detail}»` : null;
}

/** Одно слово состояния справа в строке очереди. */
export function orderStateWord(order: FeedOrder, now = Date.now()): { text: string; tone: Tone } | null {
  if (order.heldAt) return { text: "заморожен", tone: "ice" };
  const flags = flagsOf(order);
  const open = flags.find((f) => !f.ackAt);
  if (open) return { text: flagLabel(open, order, now).replace(/^\S+\s/, "").toLowerCase(), tone: FLAG_META[open.kind].tone };
  if (flags.length > 0) return { text: "договорились", tone: "green" };
  return null;
}
