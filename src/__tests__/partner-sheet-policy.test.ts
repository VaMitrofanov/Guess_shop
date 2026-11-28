import { partnerGamepassCommentValue, settledPartnerRowPolicy } from "@/lib/partner-sheet-policy";

describe("Anton settled Google Sheet rows", () => {
  it("never releases a DONE row for another task after content/status edits", () => {
    expect(settledPartnerRowPolicy("DONE", "в ожидании")).toEqual({
      preserveTask: true,
      allowReplacementTask: false,
      restoreDoneStatus: true,
    });
  });

  it("keeps an unchanged DONE row idempotent", () => {
    expect(settledPartnerRowPolicy("DONE", "готово")).toEqual({
      preserveTask: true,
      allowReplacementTask: false,
      restoreDoneStatus: false,
    });
  });

  it("allows active rows to continue through normal reconciliation", () => {
    expect(settledPartnerRowPolicy("READY", "в ожидании")).toEqual({
      preserveTask: false,
      allowReplacementTask: true,
      restoreDoneStatus: false,
    });
  });
});

describe("Anton gamepass comment in column E", () => {
  it("clears the previous error after the gamepass is corrected", () => {
    expect(partnerGamepassCommentValue(true, "Старая ошибка")).toBe("");
  });

  it("replaces a stale comment with the latest validation error", () => {
    expect(partnerGamepassCommentValue(false, "Новая ошибка")).toBe("Новая ошибка");
  });
});
