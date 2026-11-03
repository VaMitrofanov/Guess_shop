export type SettledPartnerRowPolicy = {
  preserveTask: boolean;
  allowReplacementTask: boolean;
  restoreDoneStatus: boolean;
};

/**
 * A physical Google Sheet row becomes a permanent idempotency key after payout.
 * Content edits are recorded for audit, but may never free externalRowId or create
 * another task/BUYOUT from the same row.
 */
export function settledPartnerRowPolicy(taskStatus: string | null, sheetStatus: string): SettledPartnerRowPolicy {
  const settled = taskStatus === "DONE";
  return {
    preserveTask: settled,
    allowReplacementTask: !settled,
    restoreDoneStatus: settled && sheetStatus.trim().toLowerCase() !== "готово",
  };
}

/** `externalRowId` строки таблицы. Название листа в ключе — причина ремапа ниже. */
export function buildPartnerSheetRowId(spreadsheetId: string, sheetTitle: string, rowNumber: number) {
  return `${spreadsheetId}:${sheetTitle}:${rowNumber}`;
}

/** Проекция задачи, достаточная для решений про физическую строку листа. */
export type PartnerSheetRowRef = {
  id: string;
  status: string;
  externalRowId: string | null;
  spreadsheetId: string | null;
  /** Числовой id листа: переживает переименование таба, в отличие от названия. */
  sheetId: number | null;
  sheetTitle: string | null;
  rowNumber: number | null;
};

export type PartnerRenamedRowPlan =
  | { kind: "remap"; taskId: string; fromSheetTitle: string; toSheetTitle: string; rowNumber: number; nextRowId: string }
  | { kind: "conflict"; taskId: string; toSheetTitle: string; rowNumber: number; status: string };

/**
 * Владелец переименовывает таб (например «6» → «19/07/2026»), а `externalRowId` собран из
 * НАЗВАНИЯ листа — sync принимал те же физические строки за новые и импортировал их повторно
 * со списанием (инцидент 2026-07-19: 16 строк, 10 605 R$ = 53.57 USDT двойного расхода).
 *
 * Здесь по числовому `sheetId` находим задачи с устаревшим названием листа и планируем перенос
 * их `externalRowId` на новое имя. Если целевой id уже занят другой задачей (исторический дубль
 * до этого фикса), переносить нельзя: `CANCELLED`-дубли просто пропускаем, остальное отдаём
 * как `conflict` для ручного разбора.
 */
export function planPartnerRenamedRows(input: {
  spreadsheetId: string;
  sheets: { title: string; sheetId: number }[];
  tasks: PartnerSheetRowRef[];
}): PartnerRenamedRowPlan[] {
  const titleBySheetId = new Map<number, string>();
  for (const sheet of input.sheets) titleBySheetId.set(sheet.sheetId, sheet.title);

  const occupied = new Map<string, string>();
  for (const task of input.tasks) {
    if (task.externalRowId) occupied.set(task.externalRowId, task.id);
  }

  const plans: PartnerRenamedRowPlan[] = [];
  for (const task of input.tasks) {
    if (!task.spreadsheetId || task.spreadsheetId !== input.spreadsheetId) continue;
    if (task.sheetId === null || !task.sheetTitle || task.rowNumber === null) continue;
    const currentTitle = titleBySheetId.get(task.sheetId);
    if (!currentTitle || currentTitle === task.sheetTitle) continue;

    const nextRowId = buildPartnerSheetRowId(input.spreadsheetId, currentTitle, task.rowNumber);
    const holder = occupied.get(nextRowId);
    if (holder && holder !== task.id) {
      if (task.status === "CANCELLED") continue;
      plans.push({ kind: "conflict", taskId: task.id, toSheetTitle: currentTitle, rowNumber: task.rowNumber, status: task.status });
      continue;
    }

    plans.push({
      kind: "remap", taskId: task.id, fromSheetTitle: task.sheetTitle,
      toSheetTitle: currentTitle, rowNumber: task.rowNumber, nextRowId,
    });
    if (task.externalRowId) occupied.delete(task.externalRowId);
    occupied.set(nextRowId, task.id);
  }
  return plans;
}

/**
 * Гард денег для импорта строк «готово»: та же физическая строка (`sheetId` + номер), уже
 * закрытая другой задачей, не должна создать вторую задачу со списанием. В норме такие задачи
 * переносит `planPartnerRenamedRows`; это подстраховка, когда перенос невозможен (строка занята,
 * у задачи нет `sheetId`).
 */
export function findPartnerSettledRowTwin(tasks: PartnerSheetRowRef[], row: {
  externalRowId: string;
  sheetId: number;
  rowNumber: number;
}) {
  return tasks.find((task) => task.externalRowId !== row.externalRowId
    && (task.status === "DONE" || task.status === "PURCHASING")
    && task.sheetId === row.sheetId
    && task.rowNumber === row.rowNumber) ?? null;
}

/**
 * Column E is the current validation result, not an append-only log. A corrected
 * gamepass clears the old error; a still-invalid row replaces it with the latest
 * error so Anton never sees a stale reason.
 */
export function partnerGamepassCommentValue(valid: boolean, latestError: string) {
  return valid ? "" : latestError;
}
