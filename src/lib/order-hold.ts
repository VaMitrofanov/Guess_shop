/**
 * Заморозка заказа — веб-сторона.
 *
 * Правила и работа с БД живут в `bots/shared/order-hold.ts`: боты не умеют
 * импортировать из `src/`, а веб из `bots/shared` умеет, поэтому ядро там, а
 * здесь — переэкспорт и то, что нужно только веб-админке (разбор заметки на
 * строки для TWA). Копии правил заводить нельзя: разойдутся молча.
 */

export {
  HOLD_NOTE_MARK,
  HOLD_PRESETS,
  HOLD_REASON_MAX,
  NOT_HELD,
  NOT_HELD_SQL,
  UNHOLD_NOTE_MARK,
  activeHoldCodes,
  assertOrderNotHeld,
  hasHoldNoteFor,
  heldCustomerFor,
  heldRefusal,
  holdByCode,
  isHeld,
  normalizeHoldCode,
  normalizeHoldReason,
  releaseByCode,
  sweepPendingHolds,
} from "../../bots/shared/order-hold";

import { HOLD_NOTE_MARK, UNHOLD_NOTE_MARK } from "../../bots/shared/order-hold";

/** Строка заметки, разобранная для показа в карточке TWA. */
export interface NoteLine {
  /** `[ЗАМОРОЗКА 30.08 14:12 · Вадим]` — подпись над текстом. */
  tag: string | null;
  text: string;
  /** Строка заморозки красится отдельно: голубая полоса, жирный текст. */
  kind: "hold" | "unhold" | "plain";
}

/**
 * Разобрать `adminNote` на строки.
 *
 * Код давно пишет в заметку помеченные строки (`[РЕГ-ЦЕНА`, `[НИК?`,
 * `[ПЕРЕНОС`, `[АВТОВЫКУП-ПРОПУСК`) — их просто никто не показывал отдельно:
 * заметка рендерилась одним жёлтым `textarea`, где причина «не выкупать»
 * выглядела так же, как служебный лог. Новых полей в БД для этого не нужно.
 */
export function parseAdminNote(note: string | null | undefined): NoteLine[] {
  if (!note) return [];
  return note
    .split("\n")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((line) => {
      const kind: NoteLine["kind"] = line.startsWith(HOLD_NOTE_MARK)
        ? "hold"
        : line.startsWith(UNHOLD_NOTE_MARK)
          ? "unhold"
          : "plain";

      // Помеченная строка выглядит как `[МЕТКА … ] текст`. Скобка закрывается
      // ровно один раз, поэтому режем по первой `]`, а не регуляркой.
      const close = line.startsWith("[") ? line.indexOf("]") : -1;
      if (close === -1) return { tag: null, text: line, kind };
      return {
        tag:  line.slice(1, close).trim(),
        text: line.slice(close + 1).trim(),
        kind,
      };
    });
}
