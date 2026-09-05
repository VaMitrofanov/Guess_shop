import {
  buildPartnerSheetRowId, findPartnerSettledRowTwin, planPartnerRenamedRows,
  type PartnerSheetRowRef,
} from "@/lib/partner-sheet-policy";

const SPREADSHEET = "sheet-abc";
const SHEET_ID = 1303321338;

function row(over: Partial<PartnerSheetRowRef> & { id: string }): PartnerSheetRowRef {
  const sheetTitle = over.sheetTitle ?? "6";
  const rowNumber = over.rowNumber ?? 2;
  return {
    status: "DONE",
    spreadsheetId: SPREADSHEET,
    sheetId: SHEET_ID,
    sheetTitle,
    rowNumber,
    externalRowId: buildPartnerSheetRowId(SPREADSHEET, sheetTitle, rowNumber),
    ...over,
  };
}

describe("Anton renamed Google Sheet tab (инцидент 2026-07-19)", () => {
  const sheets = [{ title: "19/07/2026", sheetId: SHEET_ID }];

  it("переносит строки переименованного листа на новое название вместо повторного импорта", () => {
    const plans = planPartnerRenamedRows({
      spreadsheetId: SPREADSHEET,
      sheets,
      tasks: [row({ id: "t2", rowNumber: 2 }), row({ id: "t3", rowNumber: 3 })],
    });

    expect(plans).toEqual([
      { kind: "remap", taskId: "t2", fromSheetTitle: "6", toSheetTitle: "19/07/2026", rowNumber: 2, nextRowId: `${SPREADSHEET}:19/07/2026:2` },
      { kind: "remap", taskId: "t3", fromSheetTitle: "6", toSheetTitle: "19/07/2026", rowNumber: 3, nextRowId: `${SPREADSHEET}:19/07/2026:3` },
    ]);
  });

  it("не трогает задачи листа, который не переименовывали", () => {
    const plans = planPartnerRenamedRows({
      spreadsheetId: SPREADSHEET,
      sheets,
      tasks: [row({ id: "t2", sheetTitle: "19/07/2026", rowNumber: 2 })],
    });
    expect(plans).toEqual([]);
  });

  it("не переносит строку, занятую другой задачей: отдаёт conflict для ручного разбора", () => {
    const plans = planPartnerRenamedRows({
      spreadsheetId: SPREADSHEET,
      sheets,
      tasks: [
        row({ id: "old", status: "READY", rowNumber: 2 }),
        row({ id: "new", sheetTitle: "19/07/2026", rowNumber: 2 }),
      ],
    });
    expect(plans).toEqual([
      { kind: "conflict", taskId: "old", toSheetTitle: "19/07/2026", rowNumber: 2, status: "READY" },
    ]);
  });

  it("молча пропускает исторические CANCELLED-дубли (сторно 25.07 уже применено)", () => {
    const plans = planPartnerRenamedRows({
      spreadsheetId: SPREADSHEET,
      sheets,
      tasks: [
        row({ id: "dup", status: "CANCELLED", rowNumber: 2 }),
        row({ id: "keep", sheetTitle: "19/07/2026", rowNumber: 2 }),
      ],
    });
    expect(plans).toEqual([]);
  });

  it("игнорирует задачи другой таблицы и задачи без sheetId", () => {
    const plans = planPartnerRenamedRows({
      spreadsheetId: SPREADSHEET,
      sheets,
      tasks: [
        row({ id: "other-book", spreadsheetId: "another-book" }),
        row({ id: "legacy", sheetId: null }),
      ],
    });
    expect(plans).toEqual([]);
  });
});

describe("гард денег: строка уже выкуплена другой задачей", () => {
  it("находит двойника той же физической строки под другим rowId", () => {
    const twin = findPartnerSettledRowTwin([row({ id: "done", rowNumber: 7 })], {
      externalRowId: `${SPREADSHEET}:19/07/2026:7`,
      sheetId: SHEET_ID,
      rowNumber: 7,
    });
    expect(twin?.id).toBe("done");
  });

  it("не считает двойником другую строку того же листа", () => {
    const twin = findPartnerSettledRowTwin([row({ id: "done", rowNumber: 7 })], {
      externalRowId: `${SPREADSHEET}:19/07/2026:8`,
      sheetId: SHEET_ID,
      rowNumber: 8,
    });
    expect(twin).toBeNull();
  });

  it("не блокирует импорт, если прежняя задача строки отменена (деньги возвращены)", () => {
    const twin = findPartnerSettledRowTwin([row({ id: "dup", status: "CANCELLED", rowNumber: 7 })], {
      externalRowId: `${SPREADSHEET}:19/07/2026:7`,
      sheetId: SHEET_ID,
      rowNumber: 7,
    });
    expect(twin).toBeNull();
  });
});
