/**
 * Алерт «оплачен — выдать код вручную» не дошёл ни разу (CODE-827TX8XJ,
 * 15.11.2026): в подсказке стояло голое «<код>», Telegram отклонял HTML целиком.
 */
import fs from "node:fs";
import path from "node:path";

const send = jest.fn();
// С 16.11.2026 первая попытка — `sendTelegramMessageId` (id алерта запоминается,
// к нему цепляется «🟢 выдан»), повтор простым текстом — `sendTelegramMessage`.
jest.mock("@/lib/telegram", () => ({
  sendTelegramMessage: (...a: unknown[]) => send(...a),
  sendTelegramMessageId: async (...a: unknown[]) => ((await send(...a)) ? 101 : null),
}));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    codeOrder: { findUnique: async () => ({
      id: "o1", deliveryMode: "EMAIL", channel: "TG", giftSendAt: null,
      publicId: "CODE-DA9VG478", denomination: 500, finalAmountKopecks: 65300,
      issuedAt: new Date(Date.now() - 134 * 60_000), chatDeliveredAt: new Date(Date.now() - 134 * 60_000),
      emailSentAt: null, giftTo: null, status: "ISSUED", createdVia: "SELF",
      creator: {
        username: "buyer_1", name: "Покупатель", tgId: "1", vkId: "77", robloxUsername: "Nick_<1>",
        createdAt: new Date("2026-08-03T10:00:00Z"), email: "buyer@mail.ru", emailVerifiedAt: null,
        referredBy: { username: null, name: "Друг", tgId: "9", vkId: null },
        _count: { codeOrders: 3, wbOrders: 2 },
      },
    }) },
    codeOrderEvent: { create: async () => ({}), findFirst: async () => null },
  },
}));
jest.mock("../../bots/shared/admin-route", () => ({
  adminTargets: async () => [{ key: "g#5", chatId: "-100", extra: { message_thread_id: 5 }, group: true }],
}));

import { buyerLines, deliveryLine, elapsedRu, notifyCodeAdmins, notifyCodeOpened, plainForTelegram } from "@/lib/codes/admin-notify";

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
    // Адрес почты в беседу не выносим никогда.
    expect(text).not.toContain("buyer@mail.ru");
    expect(extra.reply_markup?.inline_keyboard[0][0].callback_data).toBe("cdi:CODE-827TX8XJ");
  });

  it("кто купил: TG, ВК, Roblox, история и приглашение (21.11.2026)", async () => {
    send.mockResolvedValue(true);
    await notifyCodeAdmins({ marker: "done", title: "оплачен и выдан автоматически", orderPublicId: "CODE-DA9VG478", denomination: 500, amountKopecks: 65300, next: "" });
    const text = String(send.mock.calls[0][2]);
    expect(text).toContain("TG @buyer_1");
    expect(text).toContain("vk.com/gim237309399?sel=77");
    expect(text).not.toContain("(Покупатель)");
    expect(text).toContain("Roblox: <code>Nick_&lt;1&gt;</code>");
    expect(text).toContain("Покупок раньше: кодов 2, робуксов (ГП) 2");
    expect(text).toContain('<a href="tg://user?id=9">Друг</a>');
    expect(text).not.toContain("buyer@mail.ru");
  });

  it("гость и чужая оплата по ссылке", () => {
    const lines = buyerLines({ status: "PAID", channel: "SITE", createdVia: "SHARE", creator: null } as Parameters<typeof buyerLines>[0]);
    expect(lines.join("\n")).toBe("👤 Гость без входа · оформлен на сайте · оплатил другой человек по ссылке");
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

  it("каждая продажа и возврат кода видны админам (21.11.2026)", () => {
    // Автовыдача со склада и возврат банком проходили молча: увед был только
    // у ручной выдачи и у сбоя письма.
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/codes/webhook.ts"), "utf8");
    expect(src).toContain('title: "оплачен и выдан автоматически"');
    expect(src).toContain('title: "возврат подтверждён банком"');
    expect(src).toContain('title: "оплачен — выдать код вручную"');
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

describe("покупатель открыл код (21.11.2026)", () => {
  beforeEach(() => { send.mockReset().mockResolvedValue(true); process.env.TG_TOKEN = "t"; });

  it("увед в «Коды»: где открыт, через сколько после выдачи и что код уже был в чате", async () => {
    await notifyCodeOpened("o1", "cabinet");
    const text = String(send.mock.calls[0][2]);
    expect(text).toContain("покупатель открыл код");
    expect(text).toContain("CODE-DA9VG478");
    expect(text).toContain("Открыт в кабинете");
    expect(text).toMatch(/через 2 ч 1[34] мин после выдачи/);
    expect(text).toContain("в чат бота TG");
    expect(text).toContain("@buyer_1");
    // Значения кода в уведе не бывает.
    expect(text).not.toMatch(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
  });

  it("elapsedRu", () => {
    expect(elapsedRu(5 * 60_000)).toBe("5 мин");
    expect(elapsedRu(134 * 60_000)).toBe("2 ч 14 мин");
    expect(elapsedRu((3 * 24 + 4) * 3_600_000)).toBe("3 дн 4 ч");
  });

  it("кабинет и подарок зовут увед только при ПЕРВОМ показе, через защёлку", () => {
    for (const f of ["src/app/api/codes/reveal/route.ts", "src/app/api/codes/gift/route.ts"]) {
      const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
      expect(src).toMatch(/updateMany\(\{ where: \{ id: order\.id, (revealedAt|giftOpenedAt): null \}/);
      expect(src).toContain("if (first.count === 1) void notifyCodeOpened(");
    }
  });
});
