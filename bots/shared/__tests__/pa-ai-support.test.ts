/**
 * ИИ-поддержка @RobloxBank_PA (12.11.2026): страховка поверх модели и контекст.
 */
import { customerContext, guardDecision, PA_AI_SYSTEM, type PaAiDecision } from "../pa-ai-support";

const reply = (over: Partial<PaAiDecision> = {}): PaAiDecision => ({
  action: "reply", category: "order_status", reply: "Ваш заказ в очереди на выкуп.", summary: "", draft: "", ...over,
});

describe("guardDecision", () => {
  it("обычный ответ проходит как есть", () => {
    expect(guardDecision(reply(), "где мой заказ?").action).toBe("reply");
  });

  it("деньги и угрозы в сообщении — только человеку", () => {
    const d = guardDecision(reply(), "вы мошенники верните деньги");
    expect(d.action).toBe("escalate");
    expect(d.category).toBe("refund");
    expect(d.draft).toBe("Ваш заказ в очереди на выкуп.");
  });

  it("обещание денег или чужая ссылка в ответе — человеку", () => {
    expect(guardDecision(reply({ reply: "Не переживайте, вернём деньги" }), "где заказ").action).toBe("escalate");
    expect(guardDecision(reply({ reply: "Смотрите https://example.com" }), "где заказ").action).toBe("escalate");
    expect(guardDecision(reply({ reply: "Пишите в https://t.me/RobloxBankBot" }), "где заказ").action).toBe("reply");
  });

  it("смена ника — всегда человеку (случай из живого прогона)", () => {
    const d = guardDecision(reply({ category: "wrong_account", reply: "Создайте пасс на другом аккаунте" }), "не тот ник");
    expect(d.action).toBe("escalate");
    expect(d.draft).toContain("Создайте пасс");
  });

  it("пустой ответ — человеку", () => {
    expect(guardDecision(reply({ reply: "  " }), "где заказ").action).toBe("escalate");
  });
});

describe("customerContext", () => {
  const now = new Date("2026-11-12T16:00:00Z");
  it("незнакомец — так и сказано", () => {
    expect(customerContext({ name: "Анна", known: false, orders: [], now })).toContain("нет");
  });

  it("заморозка видна как «нужен человек», без внутренней причины", () => {
    const t = customerContext({
      name: "Анна", known: true, now,
      orders: [{ wbCode: "ZT8BW8D", amount: 500, status: "PENDING", createdAt: now, completedAt: null, heldAt: now,
        robloxUsername: "anya", gamepassUrl: null, isDirectOrder: false }],
    });
    expect(t).toContain("заморожен (нужен человек)");
    expect(t).toContain("ZT8BW8D");
  });

  it("база знаний стабильна: без дат и данных покупателя (иначе ломается кэш)", () => {
    expect(PA_AI_SYSTEM).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
