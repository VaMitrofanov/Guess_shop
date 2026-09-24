import { Workbook } from "exceljs";
import { PartnerXlsxParseError, parsePartnerXlsxRows } from "@/lib/partner-xlsx";

async function workbookBuffer(rows: unknown[][]) {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Импорт");
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("partner XLSX parser", () => {
  it("reads headers, formulas and rich text without SheetJS", async () => {
    const buffer = await workbookBuffer([
      ["GamePass", "Ник", "Amount"],
      [123456, { richText: [{ text: "Build" }, { text: "erman" }] }, { formula: "100+50", result: 150 }],
    ]);

    await expect(parsePartnerXlsxRows(buffer, 300)).resolves.toEqual([
      { GamePass: 123456, "Ник": "Builderman", Amount: 150 },
    ]);
  });

  it("rejects sheets above the configured row limit", async () => {
    const buffer = await workbookBuffer([["GamePass"], [1], [2]]);
    await expect(parsePartnerXlsxRows(buffer, 1)).rejects.toBeInstanceOf(PartnerXlsxParseError);
  });
});
