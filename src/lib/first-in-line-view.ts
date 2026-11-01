/* ─────────────────────────────────────────────────────────────────────────────
   «Первым делом» — как блок выглядит. Одно правило на четыре места:
   Главная и «Выкупы» в TWA, «Обзор» и «Выкупить» на сайте.

   Модуль чистый (ни prisma, ни react, ни цветов), как `order-presentation`:
   он решает, в какой группе строка, от чего считать возраст, что написать про
   пасс и какие ID отдавать донору. Каждый экран красит тон своей палитрой.
   ───────────────────────────────────────────────────────────────────────── */

import type { Tone } from "@/lib/order-presentation";
import type { FirstInLineOrder } from "@/types/first-in-line";

/** Сколько секунд «Выкуплено» можно отменить, прежде чем клиенту уйдёт сообщение. */
export const FIRST_UNDO_MS = 5_000;

export type FirstGroupId = FirstInLineOrder["reason"];

export interface FirstGroupMeta {
  id: FirstGroupId;
  icon: string;
  title: string;
  /** Почему эти заказы здесь — одной фразой рядом с заголовком. */
  hint: string;
  tone: Tone;
}

/** Порядок групп = порядок срочности: тот же, что `FIRST_IN_LINE_ORDER_SQL`. */
export const FIRST_GROUPS: readonly FirstGroupMeta[] = [
  { id: "rebuy", icon: "🔁", title: "Не дошло", hint: "покупатель не получил", tone: "pink" },
  { id: "pinned", icon: "⚡", title: "Подняты вручную", hint: "выкупать первым", tone: "yellow" },
  { id: "direct", icon: "💳", title: "Прямые", hint: "оплачены напрямую", tone: "blue" },
];

/** Только непустые группы, в фиксированном порядке. */
export function groupFirstInLine<T extends Pick<FirstInLineOrder, "reason">>(
  rows: T[],
): { group: FirstGroupMeta; rows: T[] }[] {
  return FIRST_GROUPS
    .map(group => ({ group, rows: rows.filter(row => row.reason === group.id) }))
    .filter(entry => entry.rows.length > 0);
}

/**
 * От чего считать возраст строки. Перевыкуп — от создания заказа: покупатель
 * ждёт с первого раза, и «5 мин» после возврата в очередь было бы враньём.
 */
export function firstAgeBasis(row: Pick<FirstInLineOrder, "reason" | "since" | "createdAt">): string {
  return row.reason === "rebuy" ? row.createdAt : row.since;
}

/** «2026-10-24» → «24.10» — в строке блока год не нужен. */
function shortDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}` : iso;
}

/**
 * Чем заказ закрывали в прошлый раз — из строки аудита `buildRebuyData`:
 * `[ПЕРЕВЫКУП 2026-11-01 от Вадим] COMPLETED→PENDING (закрыт 2026-10-24 Demid, вручную): …`.
 * Берётся последняя такая строка: заказ мог уходить на перевыкуп не раз.
 */
export function rebuyWasFromNote(note: string | null | undefined): string | null {
  const lines = (note ?? "").split("\n").filter(line => line.startsWith("[ПЕРЕВЫКУП "));
  const last = lines[lines.length - 1];
  const m = last?.match(/\] COMPLETED→PENDING \(([^)]*)\)/);
  return m ? m[1].replace(/\d{4}-\d{2}-\d{2}/g, shortDate) : null;
}

/** Вторая строка под кодом: откуда заказ здесь взялся. */
export function firstMetaLine(row: Pick<FirstInLineOrder, "reason" | "rebuyWas" | "priorityBy" | "priorityAt">): string | null {
  if (row.reason === "rebuy") return row.rebuyWas ? `был: ${row.rebuyWas}` : "был закрыт раньше";
  if (row.reason === "pinned" && (row.priorityBy || row.priorityAt)) {
    return `⚡ ${[row.priorityBy, row.priorityAt ? shortDate(row.priorityAt) : null].filter(Boolean).join(", ")}`;
  }
  return null;
}

/** Ответ `gp-live-check` по заказу (подмножество, которое нужно блоку). */
export interface FirstLive {
  isForSale?: boolean | null;
  livePrice?: number | null;
  priceMismatch?: boolean | null;
  expected?: number | null;
}

/**
 * Готовность пасса: можно ли его купить прямо сейчас.
 * `undefined` — проверки ещё не было; `null` — проверка не удалась (Roblox
 * молчит), тогда строки нет вовсе: «не знаем» не повод пугать красным.
 */
export function firstReadiness(
  row: Pick<FirstInLineOrder, "gamepassIds" | "gross">,
  live: FirstLive | null | undefined,
): { text: string; tone: Tone } | null {
  if (row.gamepassIds.length === 0) return { text: "пасса ещё нет", tone: "red" };
  if (live === undefined) return { text: "проверяю пасс…", tone: "muted" };
  if (live === null) return null;
  if (live.isForSale === false) return { text: "⛔ пасс снят с продажи", tone: "red" };
  if (live.priceMismatch && live.livePrice != null) {
    return {
      text: `⚠ цена ${live.livePrice.toLocaleString("ru-RU")} ≠ ${(live.expected ?? row.gross).toLocaleString("ru-RU")}`,
      tone: "orange",
    };
  }
  if (live.isForSale === true) return { text: `✓ в продаже, цена ${(live.livePrice ?? row.gross).toLocaleString("ru-RU")}`, tone: "green" };
  return null;
}

/**
 * Что отдать донору пачкой. Снятые с продажи пассы не копируются: купить их
 * нельзя, а в буфере они выглядят как обычная работа. Заказы без пасса тоже.
 * Повтор одного пасса не схлопывается — две части на одном пассе это две
 * покупки с разных аккаунтов.
 */
export function firstCopyableIds(
  rows: Pick<FirstInLineOrder, "id" | "gamepassIds">[],
  live: Record<string, FirstLive | null | undefined>,
): { ids: string[]; orders: number; noPass: number; offSale: number } {
  let noPass = 0;
  let offSale = 0;
  let orders = 0;
  const ids: string[] = [];
  for (const row of rows) {
    if (row.gamepassIds.length === 0) { noPass += 1; continue; }
    if (live[row.id]?.isForSale === false) { offSale += 1; continue; }
    orders += 1;
    ids.push(...row.gamepassIds);
  }
  return { ids, orders, noPass, offSale };
}

/** Текст тоста после копирования — одинаковый на всех экранах. */
export function firstCopyToast(label: string, result: ReturnType<typeof firstCopyableIds>): string {
  if (result.ids.length === 0) {
    return result.offSale > 0 ? `${label}: все пассы сняты с продажи` : `${label}: пассов ещё нет`;
  }
  return `⧉ ${label}: ${result.ids.length} ID`
    + (result.ids.length !== result.orders ? ` из ${result.orders} заказов` : "")
    + (result.offSale > 0 ? ` · снято с продажи: ${result.offSale}` : "")
    + (result.noPass > 0 ? ` · без пасса: ${result.noPass}` : "");
}

/** Пустая заметка у перевыкупа показывает причину — иначе её не видно в блоке. */
export function firstNoteText(row: Pick<FirstInLineOrder, "note" | "rebuyReason">): { text: string; empty: boolean } {
  if (row.note) return { text: row.note, empty: false };
  if (row.rebuyReason) return { text: `не дошло: ${row.rebuyReason}`, empty: false };
  return { text: "+ заметка", empty: true };
}

/** Сколько заказов не влезло в блок — для «Ещё N в очереди →». */
export function firstHiddenCount(data: { rows: unknown[]; total: number }): number {
  return Math.max(0, data.total - data.rows.length);
}
