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

import { partAmountForPrice, splitProgressText, splitRemaining } from "../wb-chat-gamepass";
describe("набор пассов по одному (27.11.2026, D5R4NN7)", () => {
  it("цена → номинал части", () => {
    expect(partAmountForPrice(2143, 2000)).toBe(1500);
    expect(partAmountForPrice(715, 2000)).toBe(500);
    expect(partAmountForPrice(1429, 2600)).toBe(1000);
    expect(partAmountForPrice(300, 2000)).toBeNull();
  });
  it("остаток и подсказка", () => {
    const parts = [{ gamepassId: "1", amount: 1500, price: 2143, creator: "a" }];
    expect(splitRemaining(2000, parts)).toEqual({ remaining: 500, need: [500] });
    expect(splitProgressText(2000, parts)).toMatch(/Осталось 500 R\$ — пришлите геймпасс за 715 R\$/);
  });
});

import { findGamepassRefsInChatText, splitBatchText } from "../wb-chat-gamepass";
describe("несколько пассов в одном сообщении (28.11.2026)", () => {
  it("голые id и ссылки — все", () => {
    expect(findGamepassRefsInChatText("2099689546 и https://www.roblox.com/game-pass/2102262561/pass")).toEqual(["2102262561", "2099689546"]);
    expect(findGamepassRefsInChatText("2099689546\n2102262561")).toEqual(["2099689546", "2102262561"]);
  });
  it("id плейса из ссылки на игру — не пасс", () => {
    expect(findGamepassRefsInChatText("https://www.roblox.com/games/1234567890/x")).toEqual([]);
  });
  it("номер товара WB отсекается", () => {
    expect(findGamepassRefsInChatText("123456789 2099689546", 123456789)).toEqual(["2099689546"]);
  });
  it("итог: собрано и что осталось", () => {
    const parts = [{ gamepassId: "1", amount: 1500, price: 2143, creator: "a" }];
    const out = [{ kind: "partial", parts, remaining: 500, need: [500] } as never, { kind: "rejected", gamepassId: "2", reason: "пасс не выставлен на продажу", toBuyer: true } as never];
    const t = splitBatchText(2000, parts, out)!;
    expect(t).toMatch(/Геймпасс 2: пасс не выставлен/);
    expect(t).toMatch(/Принято ✅ Собрано 1500 = 1500 из 2000 R\$/);
    expect(t).toMatch(/715 R\$/);
  });
});
