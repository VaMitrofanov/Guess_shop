import { Workbook, type CellValue } from "exceljs";

export class PartnerXlsxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartnerXlsxParseError";
  }
}

function cellValue(value: CellValue): unknown {
  if (value === null || value === undefined || typeof value !== "object" || value instanceof Date) return value ?? null;
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("hyperlink" in value) return value.text || value.hyperlink;
  if ("formula" in value || "sharedFormula" in value) return cellValue(value.result);
  if ("error" in value) return value.error;
  return String(value);
}

/**
 * Reads only cell data needed by the trusted admin import. Styling, drawings,
 * validations and links are ignored to reduce parser work and attack surface.
 */
export async function parsePartnerXlsxRows(buffer: Buffer, maxRows: number) {
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0], {
    ignoreNodes: ["dataValidations", "drawing", "extLst", "headerFooter", "hyperlinks", "picture", "sheetProtection"],
  });
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new PartnerXlsxParseError("В XLSX нет листов");
  if (sheet.actualRowCount > maxRows + 1) {
    throw new PartnerXlsxParseError(`Слишком много строк: максимум ${maxRows}`);
  }

  const header = sheet.getRow(1);
  const headers = Array.from({ length: header.cellCount }, (_, index) =>
    String(cellValue(header.getCell(index + 1).value) ?? ""),
  );
  const rows: Record<string, unknown>[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const excelRow = sheet.getRow(rowNumber);
    const row: Record<string, unknown> = {};
    for (let column = 1; column <= headers.length; column += 1) {
      if (headers[column - 1]) row[headers[column - 1]] = cellValue(excelRow.getCell(column).value);
    }
    if (Object.values(row).some((value) => value !== null && value !== undefined && value !== "")) rows.push(row);
  }
  return rows;
}
