/**
 * Алерт «оплачен — выдать код вручную» не дошёл ни разу (CODE-827TX8XJ,
 * 15.11.2026): в подсказке стояло голое «<код>», Telegram отклонял HTML целиком.
 */
import fs from "node:fs";
import path from "node:path";

const send = jest.fn();
jest.mock("@/lib/telegram", () => ({ sendTelegramMessage: (...a: unknown[]) => send(...a) }));
jest.mock("@/lib/prisma", () => ({
  prisma: { codeOrder: { findUnique: async () => ({ deliveryMode: "EMAIL", channel: "SITE", giftSendAt: null }) } },
}));
jest.mock("../../bots/shared/admin-route", () => ({
  adminTargets: async () => [{ key: "g#5", chatId: "-100", extra: { message_thread_id: 5 }, group: true }],
}));

import { deliveryLine, notifyCodeAdmins, plainForTelegram } from "@/lib/codes/admin-notify";

describe("алерт заказа кода", () => {
  beforeEach(() => { send.mockReset(); process.env.TG_TOKEN = "t"; });

  it("Telegram отклонил разметку — повтор простым текстом", async () => {
    send.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await notifyCodeAdmins({ marker: "urgent", title: "оплачен", orderPublicId: "CODE-1", denomination: 1000, amountKopecks: 119900, next: "x" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(String(send.mock.calls[1][2])).not.toMatch(/<[a-z]/i);
    expect(String(send.mock.calls[1][2])).toContain("CODE-1");
  });

  it("ручная выдача — кнопка «Выдать код» и куда уйдёт код, без адреса", async () => {
    send.mockResolvedValue(true);
    await notifyCodeAdmins({ marker: "urgent", title: "оплачен — выдать код вручную", orderPublicId: "CODE-827TX8XJ", denomination: 1000, amountKopecks: 119900, next: "x", issueButton: true });
    const [, , text, extra] = send.mock.calls[0] as [string, string, string, { reply_markup?: { inline_keyboard: Array<Array<{ callback_data: string }>> } }];
    expect(text).toContain("📬 Код уйдёт письмом на почту покупателя");
    expect(text).not.toContain("@");
    expect(extra.reply_markup?.inline_keyboard[0][0].callback_data).toBe("cdi:CODE-827TX8XJ");
  });

  it("строка доставки для бота и подарка", () => {
    expect(deliveryLine({ deliveryMode: "ACCOUNT", channel: "TG", giftSendAt: null })).toContain("в чат бота TG");
    expect(deliveryLine({ deliveryMode: "GIFT", channel: "SITE", giftSendAt: null })).toContain("Подарок-открытка");
  });

  it("plainForTelegram экранирует угловые скобки", () => {
    expect(plainForTelegram("<b>a</b> &lt;код&gt; & b")).toBe("a &lt;код&gt; &amp; b");
  });

  it("в подсказках вебхука нет голых угловых скобок", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/codes/webhook.ts"), "utf8");
    const nexts = [...src.matchAll(/next:\s*(`[^`]*`|"[^"]*")/g)].map((m) => m[1]);
    expect(nexts.length).toBeGreaterThan(0);
    for (const n of nexts) expect(n.replace(/\$\{[^}]*\}/g, "")).not.toMatch(/<[^a/]/);
  });
});

import { buildCodeEmail } from "@/lib/codes/delivery";
jest.mock("@/lib/mailer", () => ({ sendMail: jest.fn() }));

describe("письмо с кодом — подарочная карта (16.11.2026)", () => {
  const base = { denomination: 1000, code: "ABCD-1234-EFGH", publicId: "CODE-827TX8XJ", account: false };

  it("код, номинал, кнопка активации и подпись команды — в HTML и в тексте", () => {
    const m = buildCodeEmail(base);
    for (const part of [m.html, m.text]) {
      expect(part).toContain("ABCD-1234-EFGH");
      expect(part).toContain("Команда RobloxBank");
    }
    expect(m.html).toContain("ПОДАРОЧНЫЙ КОД");
    expect(m.html).toContain("https://www.roblox.com/redeem");
    expect(m.subject).toMatch(/1\s000 Robux/);
  });

  it("«спасибо за терпение» — только при ручной выдаче с ожиданием", () => {
    expect(buildCodeEmail(base).html).not.toContain("Спасибо за терпение");
    expect(buildCodeEmail({ ...base, waited: true }).html).toContain("Спасибо за терпение");
  });

  it("код экранируется", () => {
    expect(buildCodeEmail({ ...base, code: "<b>X1</b>" }).html).toContain("&lt;b&gt;X1");
  });
});
