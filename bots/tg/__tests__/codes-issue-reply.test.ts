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

import { amountLineFrom, issuedAlertText } from "../codes-issue-reply";

describe("алерт после выдачи", () => {
  const plain = "🔴 САЙТ · код активации: оплачен — выдать код вручную\n🎟 CODE-827TX8XJ · 1 000 R$ · 1 199 ₽\n📬 Код уйдёт письмом";

  it("строку заказа берёт из простого текста алерта", () => {
    expect(amountLineFrom(plain, "CODE-827TX8XJ")).toBe("<code>CODE-827TX8XJ</code> · 1 000 R$ · 1 199 ₽");
  });

  it("говорит, кто выдал и дошло ли письмо", () => {
    const text = issuedAlertText({ publicId: "CODE-827TX8XJ", amountLine: amountLineFrom(plain, "CODE-827TX8XJ"), code: "ABCD-1234", actor: "@owner", at: new Date(Date.UTC(2026, 10, 15, 18, 40)), email: "sent", chat: null });
    expect(text).toContain("🟢 <b>САЙТ · код активации: выдан</b>");
    expect(text).toContain("✅ @owner · 21:40 · 📬 письмо ушло");
    // Какой код ушёл — видно в уведе, под спойлером (16.11: не удалять, не путаться).
    expect(text).toContain("🔑 Код: <tg-spoiler><code>ABCD-1234</code></tg-spoiler>");
  });

  it("письмо не ушло — это видно", () => {
    expect(issuedAlertText({ publicId: "CODE-1", amountLine: null, actor: "a", at: new Date(), email: "failed" })).toContain("письмо НЕ ушло");
  });
});

import { codeCopyText } from "../codes-issue-reply";

describe("копия сообщения с кодом — под спойлером", () => {
  const at = new Date(Date.UTC(2026, 10, 15, 18, 40));
  it("выдан: заказ, код под спойлером, кто прислал", () => {
    const t = codeCopyText({ publicId: "CODE-827TX8XJ", code: "ABCD-1234", actor: "@owner", at, issued: true });
    expect(t).toContain("🔑 <b>Код выдан</b> · <code>CODE-827TX8XJ</code>");
    expect(t).toContain("<tg-spoiler><code>ABCD-1234</code></tg-spoiler>");
    expect(t).toContain("прислал @owner · 21:40");
  });
  it("не выдан: причина и что делать", () => {
    const t = codeCopyText({ publicId: "CODE-1", code: "X1Y2Z3", actor: "a", at, issued: false, reason: "номинал не совпал с заказом" });
    expect(t).toContain("Код НЕ выдан");
    expect(t).toContain("номинал не совпал");
    expect(t).toContain("<tg-spoiler>");
  });
});
