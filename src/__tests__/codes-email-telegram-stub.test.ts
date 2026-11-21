import { writeFileSync } from "node:fs";

jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/mailer", () => ({ sendMail: jest.fn() }));
jest.mock("@/lib/codes/chat-notify", () => ({ sendCodeToChat: jest.fn() }));

import { buildCodeEmail } from "@/lib/codes/delivery";

/** 🎨 И1 (18.11.2026): корешок «Статус в Telegram» в письме с кодом. */
describe("письмо с кодом: корешок Telegram", () => {
  it("со ссылкой — корешок в HTML и строка в тексте; без — письмо как раньше", () => {
    const url = "https://t.me/RobloxBankBot?start=ln_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const m = buildCodeEmail({ denomination: 800, code: "ABCD-EFGH-JKLM", publicId: "CODE-H2U9TA58", account: true, telegramUrl: url });
    expect(m.html).toContain("КОРЕШОК");
    expect(m.html).toContain(url);
    expect(m.text).toContain(url);
    if (process.env.EMAIL_PREVIEW_OUT) writeFileSync(process.env.EMAIL_PREVIEW_OUT, m.html);
    const plain = buildCodeEmail({ denomination: 800, code: "X", publicId: "CODE-H2U9TA58", account: false });
    expect(plain.html).not.toContain("КОРЕШОК");
    expect(plain.html).toContain("border-radius:0 0 22px 22px");
  });
});
