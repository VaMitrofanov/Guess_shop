jest.mock("../../shared/admin", () => ({ ADMIN_IDS: ["1"] }));
jest.mock("../../shared/codes-bot-api", () => ({ issueCodeViaWeb: jest.fn() }));
import { looksLikeGiftCode, parseIssueCommand } from "../codes-issue-reply";

describe("выдача кода из беседы (16.11.2026)", () => {
  it("код распознаётся в разных записях, обычная речь — нет", () => {
    for (const t of ["ABCD-1234-EFGH", "abcd1234efgh", "1234 5678 9012", "R0BUX1234567"]) expect(looksLikeGiftCode(t)).toBe(true);
    for (const t of ["ок, сейчас найду код", "спасибо", "/issue", "ABCDEFGH", ""]) expect(looksLikeGiftCode(t)).toBe(false);
  });

  it("/issue — номер заказа и код", () => {
    expect(parseIssueCommand("/issue code-827tx8xj ABCD-1234")).toEqual({ publicId: "CODE-827TX8XJ", code: "ABCD-1234" });
    expect(parseIssueCommand("/issue@RobloxBankBot CODE-827TX8XJ 1234")).toEqual({ publicId: "CODE-827TX8XJ", code: "1234" });
    expect(parseIssueCommand("/issue CODE-827TX8XJ")).toBeNull();
  });
});
