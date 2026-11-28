jest.mock("../db", () => ({ db: {} }));
import { describePass, orderProblemRu } from "../support-ai-facts";
import { guardDecision, unknownFacts } from "../pa-ai-support";
import { holdingText, isHoldingText, isNightMsk } from "../wb-chat-ai";
import { Debouncer, trailingUserText } from "../support-ai";

describe("сверка фактов в ответе ИИ (27.11.2026)", () => {
  const ctx = "• Заказ TSTWLMY: 500 R$, в очереди на выкуп; ник Roblox: kid";
  it("код и сумма из данных — чисто", () => {
    expect(unknownFacts("Заказ TSTWLMY на 500 R$ в очереди. Пасс за 715 R$.", ctx)).toEqual([]);
    expect(unknownFacts("Заказ на 1 000 R$", "Заказ X: 1000 R$")).toEqual([]);
  });
  it("выдуманный код и сумма — ловит", () => {
    expect(unknownFacts("Заказ ABC1234 на 3700 R$", ctx)).toEqual(["ABC1234", "3700 R$"]);
  });
  it("guard уводит выдумку человеку", () => {
    const d = guardDecision({ action: "reply", category: "order_status", reply: "Заказ QQQ9999 выкуплен.", summary: "", draft: "" }, "где заказ", "vk_bot", { known: ctx });
    expect(d.action).toBe("escalate");
  });
});

describe("проверка пасса и причины для покупателя", () => {
  const ok = { price: 715, forSale: true, managed: false, regional: false, privateGame: false, ageRestricted: false, notFound: false };
  it("всё в порядке", () => expect(describePass("1", 715, ok)).toMatch(/всё в порядке/));
  it("цена, продажа, регион", () => {
    const t = describePass("1", 715, { ...ok, price: 700, forSale: false, regional: true });
    expect(t).toMatch(/700 R\$ вместо нужных 715/);
    expect(t).toMatch(/Item for sale/);
    expect(t).toMatch(/Regional pricing/);
  });
  it("заморозка по отзыву — без внутренней причины", () => {
    expect(orderProblemRu({ status: "PENDING", heldAt: new Date(), heldReason: "плохой отзыв WB (Евгений, ★1)" })).toMatch(/проверке у менеджера/);
    expect(orderProblemRu({ status: "ERROR", adminNote: "x\n[ЦЕНА-СТОП] 700 вместо 715" })).toMatch(/цена пасса/);
  });
});

describe("заглушка WB и склейка сообщений", () => {
  it("ночь по МСК", () => {
    expect(isNightMsk(new Date("2026-11-27T21:00:00Z"))).toBe(true); // 00:00 МСК
    expect(isNightMsk(new Date("2026-11-27T10:00:00Z"))).toBe(false); // 13:00 МСК
    expect(holdingText(new Date("2026-11-27T21:00:00Z"))).toMatch(/утром/);
    expect(isHoldingText(holdingText())).toBe(true);
  });
  it("хвост сообщений покупателя", () => {
    expect(trailingUserText([{ role: "assistant", text: "a" }, { role: "user", text: "здравствуйте" }, { role: "user", text: "где робуксы" }])).toBe("здравствуйте\nгде робуксы");
  });
  it("запускается только последний вызов", async () => {
    jest.useFakeTimers();
    const d = new Debouncer(); const calls: number[] = [];
    d.schedule("k", 100, async () => { calls.push(1); });
    d.schedule("k", 100, async () => { calls.push(2); });
    jest.advanceTimersByTime(150);
    await Promise.resolve();
    expect(calls).toEqual([2]);
    jest.useRealTimers();
  });
});

import { examplesBlock, exampleWorthKeeping } from "../support-ai-learn";
describe("примеры операторов для ИИ", () => {
  it("секреты и мусор не храним", () => {
    expect(exampleWorthKeeping("где робуксы?", "Заказ в очереди, выкупим и напишем.")).toBe(true);
    expect(exampleWorthKeeping("вот ключ", "Спасибо, ключ rbx-abcdef получили")).toBe(false);
    expect(exampleWorthKeeping("код", "Код 123456 принят, спасибо")).toBe(false);
    expect(exampleWorthKeeping("ок", "Спасибо!")).toBe(false);
  });
  it("блок промпта", () => {
    expect(examplesBlock([])).toBe("");
    expect(examplesBlock([{ channel: "wb_chat", question: "где?", answer: "В очереди.", by: "a", at: "" }])).toMatch(/Оператор: «В очереди\.»/);
  });
});
