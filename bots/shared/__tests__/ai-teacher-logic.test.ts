jest.mock("@anthropic-ai/sdk", () => jest.fn(), { virtual: true });
jest.mock("@anthropic-ai/sdk/helpers/zod", () => ({ zodOutputFormat: jest.fn() }), { virtual: true });
jest.mock("../../tg/pa-ai", () => ({ card: jest.fn(), loadSettings: jest.fn(), saveSettings: jest.fn() }));
jest.mock("../../tg/support-ai-direct", () => ({ decideSupportDirect: jest.fn() }));
jest.mock("../db", () => ({ db: {} }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const t = require("../../tg/ai-teacher");

describe("учитель воркера", () => {
  it("сводит решение воркера с ответом оператора на тот же вопрос", () => {
    const at = new Date("2026-11-28T10:00:00Z");
    const cases = t.matchCases(
      [{ channel: "tg_pa", action: "escalate", question: "когда придут робуксы по заказу", answer: null, summary: "спрашивает сроки", createdAt: at }],
      [
        { channel: "tg_pa", question: "Здравствуйте, когда придут робуксы по заказу?", answer: "Заказ в очереди, напишем", by: "op", at: "2026-11-28T10:20:00Z" },
        { channel: "vk_bot", question: "когда придут робуксы по заказу", answer: "x", by: "op", at: "2026-11-28T10:20:00Z" },
      ],
    );
    expect(cases).toHaveLength(1);
    expect(cases[0].operator).toBe("Заказ в очереди, напишем");
  });
  it("применяет пачку правок, не сдвигая номера", () => {
    const out = t.applyAll(["a", "b", "c"], [
      { op: "remove", rule: 1, text: "", why: "" },
      { op: "replace", rule: 3, text: "C", why: "" },
      { op: "add", rule: null, text: "d", why: "" },
    ]);
    expect(out).toEqual(["b", "C", "d"]);
  });
});
