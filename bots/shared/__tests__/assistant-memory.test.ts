import { forgetTurns, memoryKey, recallTurns, rememberExchange, replyContext, withReplyContext } from "../assistant-memory";

describe("assistant-memory", () => {
  const key = memoryKey(-100, 7, 42);
  afterEach(() => forgetTurns(key));

  it("помнит пары вопрос–ответ по порядку", () => {
    rememberExchange(key, "RVAMP3J", "Заказ RVAMP3J: выкуплен", 1000);
    rememberExchange(key, "проблемы были?", "Нет", 2000);
    expect(recallTurns(key, 3000).map((t) => t.text)).toEqual(["RVAMP3J", "Заказ RVAMP3J: выкуплен", "проблемы были?", "Нет"]);
  });

  it("забывает через 30 минут тишины", () => {
    rememberExchange(key, "q", "a", 0);
    expect(recallTurns(key, 29 * 60_000)).toHaveLength(2);
    expect(recallTurns(key, 31 * 60_000)).toEqual([]);
  });

  it("держит не больше 5 пар и начинается с вопроса", () => {
    for (let i = 0; i < 8; i++) rememberExchange(key, `q${i}`, `a${i}`, i);
    const turns = recallTurns(key, 10);
    expect(turns).toHaveLength(10);
    expect(turns[0]).toEqual({ role: "user", text: "q3" });
  });

  it("разные админы и темы — разная память", () => {
    expect(memoryKey(-100, 7, 1)).not.toBe(memoryKey(-100, 7, 2));
    expect(memoryKey(-100, 7, 1)).not.toBe(memoryKey(-100, 8, 1));
  });

  it("корень темы форума — не ответ", () => {
    expect(replyContext({ text: "Ассистент", forum_topic_created: {} })).toBeNull();
    expect(replyContext(undefined)).toBeNull();
  });

  it("берёт текст, кнопки и цитату", () => {
    const reply = { text: "Новый заказ", from: { is_bot: true }, reply_markup: { inline_keyboard: [[{ text: "📱 RVAMP3J — открыть в TWA" }]] } };
    expect(replyContext(reply)).toContain("RVAMP3J — открыть в TWA");
    expect(replyContext(reply, { text: "кусок" })).toContain("Цитата");
    expect(replyContext(reply, { text: "кусок" })).not.toContain("Новый заказ");
  });

  it("свой ответ из памяти второй раз не шлёт", () => {
    expect(replyContext({ text: "Нет", from: { is_bot: true } }, undefined, ["Нет"])).toBeNull();
  });

  it("склеивает контекст и вопрос", () => {
    expect(withReplyContext("q", null)).toBe("q");
    expect(withReplyContext("q", "ctx")).toBe("ctx\n\n[Вопрос]\nq");
  });
});
