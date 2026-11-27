jest.mock("../db", () => ({ db: {} }));

import { closedKeyboard, escalationKeyboard, manualRow } from "../wb-ai-cards";
import { botTextSet, isHumanSellerMsg, lastHumanReply } from "../wb-chat-ai";

describe("карточки воркера", () => {
  it("эскалация по геймпассу: Отправить, Взять аккаунт, Веду сам", () => {
    const kb = escalationKeyboard({ orderId: "o1", sendKey: "e1", draft: "текст", category: "gamepass_problem", manual: false });
    expect(kb.map((r) => r[0].text)).toEqual(["📤 Отправить", "🔐 Взять аккаунт на себя", "✋ Веду сам"]);
  });
  it("в ручном режиме — «Вернуть воркеру»", () => {
    expect(manualRow("o1", true)[0].text).toBe("🤖 Вернуть воркеру");
  });
  it("закрытая карточка — факт без «Отправить»", () => {
    const kb = closedKeyboard("o1", "✅ ответил @x 11:41", false);
    expect(kb[0][0].text).toBe("✅ ответил @x 11:41");
    expect(JSON.stringify(kb)).not.toContain("Отправить");
  });
});

describe("кто ведёт чат", () => {
  const now = Date.parse("2026-11-27T09:00:00Z");
  const at = (m: number) => new Date(now - m * 60_000);
  const bot = botTextSet(["Понимаю. С телефона плейс не создать"]);
  it("ответ из TG (локальная запись) — человек", () => {
    expect(isHumanSellerMsg({ text: "что угодно", sentAt: at(1), local: true, viaTg: true }, bot)).toBe(true);
  });
  it("окно 2 часа", () => {
    const m = [{ text: "ручной ответ", sentAt: at(90), local: false }];
    expect(lastHumanReply(m, bot, [], now)).not.toBeNull();
    expect(lastHumanReply([{ ...m[0], sentAt: at(150) }], bot, [], now)).toBeNull();
  });
});
