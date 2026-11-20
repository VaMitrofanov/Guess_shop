/**
 * Наборы кодов (20.11.2026): «2 000 R$» = два кода по 1 000, «199 R$» = код 200.
 * Чистые части — без базы: разбор сообщения админа, тексты письма и чата.
 */
jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/mailer", () => ({ sendMail: jest.fn() }));
jest.mock("@/lib/telegram", () => ({ sendTelegramMessage: jest.fn(), sendTelegramMessageId: jest.fn() }));

import { splitIssuedCodes } from "@/lib/codes/manual-issue";
import { buildCodeEmail } from "@/lib/codes/delivery";
import { supplierLabel } from "@/lib/codes/admin-notify";
import { codeChatIssuedText, codePickScreen } from "../../bots/shared/codes-shop";

/** toLocaleString ставит неразрывный пробел в «2 000». */
const sp = (value: string | null) => value?.replace(/\u00a0/g, " ") ?? value;

describe("ручная выдача набора", () => {
  test("один код — текст целиком, даже с пробелами", () => {
    expect(splitIssuedCodes(" ABCD 1234 EFGH ", 1)).toEqual(["ABCD 1234 EFGH"]);
  });

  test("набор — по строкам, запятым или пробелам", () => {
    expect(splitIssuedCodes("AAAA-1111\nBBBB-2222", 2)).toEqual(["AAAA-1111", "BBBB-2222"]);
    expect(splitIssuedCodes("AAAA1111, BBBB2222", 2)).toEqual(["AAAA1111", "BBBB2222"]);
    expect(splitIssuedCodes("AAAA1111 BBBB2222", 2)).toEqual(["AAAA1111", "BBBB2222"]);
    // Одна строка с пробелами внутри кода — не «два кода», а несовпадение числа.
    expect(splitIssuedCodes("AAAA 1111 BBBB", 2)).toHaveLength(3);
  });

  test("алерт админам говорит, какие коды поставщика нужны", () => {
    expect(sp(supplierLabel(2000))).toBe("2 кода по 1 000 R$");
    expect(supplierLabel(199)).toBe("код 200 R$");
    expect(supplierLabel(800)).toBeNull();
  });
});

describe("покупатель видит каждый код набора", () => {
  test("письмо: оба кода, каждый своей рамкой, тема во множественном", () => {
    const raw = buildCodeEmail({ denomination: 2000, code: "AAAA1111", codes: ["AAAA1111", "BBBB2222"], publicId: "CODE-AAAA2222", account: false });
    const mail = { subject: sp(raw.subject)!, text: sp(raw.text)!, html: sp(raw.html)! };
    expect(mail.subject).toContain("коды на 2 000 Robux");
    expect(mail.text).toContain("Код 1: AAAA1111");
    expect(mail.text).toContain("Код 2: BBBB2222");
    expect(mail.html).toContain("AAAA1111");
    expect(mail.html).toContain("BBBB2222");
    expect(mail.html).toContain("2 × 1 000 ROBUX");
  });

  test("письмо с одним кодом — как раньше", () => {
    const mail = buildCodeEmail({ denomination: 800, code: "X1Y2Z3", publicId: "CODE-AAAA2222", account: false });
    expect(mail.subject).toContain("Ваш код на 800 Robux");
    expect(mail.text).toContain("Код: X1Y2Z3");
  });

  test("чат: два кода под спойлером, пронумерованы", () => {
    const text = codeChatIssuedText({ denomination: 2000, code: "AAAA1111", codes: ["AAAA1111", "BBBB2222"], publicId: "CODE-X" });
    expect(text.html).toContain("2 кода на 2 000 Robux");
    expect(text.html).toContain("1. <tg-spoiler><code>AAAA1111</code></tg-spoiler>");
    expect(text.html).toContain("2. <tg-spoiler><code>BBBB2222</code></tg-spoiler>");
    expect(text.plain).toContain("каждый на 1 000 Robux");
  });

  test("карточка заказа в боте: сумма из заказа и пояснение для 199 и 2 000", () => {
    const base = { discountPercent: 0, instant: false, payUrl: "https://x/pay", shareUrl: "https://x/pay", publicId: "CODE-X" };
    const card199 = codePickScreen({ ...base, denomination: 199, baseAmountKopecks: 36_500, finalAmountKopecks: 36_500 });
    expect(card199.html).toContain("аккаунты РФ получат 199 Robux");
    expect(card199.rows[0][0].label).toContain("365 ₽");
    expect(codePickScreen({ ...base, denomination: 2000 }).html).toContain("2 кода по 1 000 Robux");
  });
});
