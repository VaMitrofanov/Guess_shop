jest.mock("../db", () => ({ db: {} }));

import { asPaAiDecision, guardDecision, plain, type PaAiDecision } from "../pa-ai-support";
import { isConversationalText, parseSupportAiRequest, TurnMemory } from "../support-ai";
import { buyerTailText, chatsAwaitingReply, humanRepliedRecently, isAutoSellerText, wbChatTextForAi } from "../wb-chat-ai";

const reply = (text: string): PaAiDecision => ({ action: "reply", category: "how_to", reply: text, summary: "", draft: "" });

describe("разговорный текст — для ИИ, ввод флоу — нет", () => {
  it.each([
    "как создать геймпасс?",
    "у меня не получается создать пасс помогите",
    "где мой заказ?",
  ])("берём: %s", (t) => expect(isConversationalText(t)).toBe(true));

  it.each([
    "Kabsjdvdnd",
    "ABC1234",
    "1000",
    "https://www.roblox.com/game-pass/123456789",
    "mail@example.com",
    "Начать",
    "спасибо",
  ])("не берём: %s", (t) => expect(isConversationalText(t)).toBe(false));
});

describe("мост ИИ: вход и выход проверяются", () => {
  it("чужой канал и мусор — отказ", () => {
    expect(parseSupportAiRequest({ channel: "email", context: "x", turns: [] })).toBeNull();
    expect(parseSupportAiRequest(null)).toBeNull();
  });
  it("все четыре канала принимаются, включая бот TG", () => {
    for (const channel of ["tg_pa", "tg_bot", "vk_bot", "wb_chat"]) {
      expect(parseSupportAiRequest({ channel, context: "c", turns: [] })?.channel).toBe(channel);
    }
  });
  it("реплики обрезаются и фильтруются", () => {
    const r = parseSupportAiRequest({
      channel: "vk_bot", context: "ctx",
      turns: [{ role: "system", text: "x" }, ...Array.from({ length: 20 }, (_, i) => ({ role: "user", text: `m${i}` }))],
    })!;
    expect(r.turns).toHaveLength(12);
    expect(r.turns.every((t) => t.role === "user")).toBe(true);
  });
  it("решение из сети без zod", () => {
    expect(asPaAiDecision({ action: "reply", category: "how_to", reply: "a", summary: "", draft: "" })).not.toBeNull();
    expect(asPaAiDecision({ action: "refund_now", category: "how_to", reply: "a", summary: "", draft: "" })).toBeNull();
    expect(asPaAiDecision({ action: "reply", category: "nope", reply: "a", summary: "", draft: "" })).toBeNull();
  });
});

describe("чат WB: другие площадки — только через человека", () => {
  it.each([
    "Напишите нам в Telegram @RobloxBank_PA",
    "Удобнее во ВКонтакте",
    "можно в вк",
    "на нашем сайте есть инструкция",
  ])("%s → escalate", (t) => {
    const d = guardDecision(reply(t), "как быть?", "wb_chat");
    expect(d.action).toBe("escalate");
    // Черновик проходит ту же «живость» (заглавная буква в начале).
    expect(d.draft.toLowerCase()).toBe(t.toLowerCase());
  });
  it("Roblox-ссылка в чате WB допустима", () => {
    expect(guardDecision(reply("Откройте https://create.roblox.com/dashboard/creations"), "где?", "wb_chat").action).toBe("reply");
  });
  it("в ВК то же правило не действует", () => {
    expect(guardDecision(reply("можно и в вк спросить"), "где?", "vk_bot").action).toBe("reply");
  });
});

describe("чат WB: какие чаты ждут ответа", () => {
  const now = Date.parse("2026-11-13T12:00:00Z");
  const ev = (chatId: string, sender: string, minAgo: number, extra: Record<string, unknown> = {}) => ({
    id: `${chatId}${minAgo}`, wbEventId: `${chatId}-${minAgo}`, chatId, sender, textRedacted: "как создать пасс?",
    containsDeliveryCode: false, sentAt: new Date(now - minAgo * 60_000), marketplaceOrderId: "o1", ...extra,
  });
  it("последнее слово покупателя, старше 90 с — ждёт", () => {
    expect(chatsAwaitingReply([ev("a", "client", 5), ev("a", "seller", 10)], now).map((e) => e.chatId)).toEqual(["a"]);
  });
  it("ответили после — не ждёт; свежее 90 с — рано; код доставки — автоматике", () => {
    expect(chatsAwaitingReply([ev("a", "client", 10), ev("a", "seller", 5)], now)).toEqual([]);
    expect(chatsAwaitingReply([ev("b", "client", 1)], now)).toEqual([]);
    expect(chatsAwaitingReply([ev("c", "client", 5, { containsDeliveryCode: true })], now)).toEqual([]);
  });
  it("код и пасс в тексте — не для ИИ", () => {
    expect(wbChatTextForAi("595 081")).toBe(false);
    expect(wbChatTextForAi("вот https://www.roblox.com/game-pass/1234567890/x")).toBe(false);
    expect(wbChatTextForAi("а сколько ждать?")).toBe(true);
  });
});

describe("память реплик", () => {
  it("держит последние N", () => {
    const m = new TurnMemory(3);
    for (let i = 0; i < 5; i++) m.push("u", "user", `t${i}`);
    expect(m.get("u").map((t) => t.text)).toEqual(["t2", "t3", "t4"]);
  });
});

describe("buyerTailText — карточка показывает всю очередь покупателя", () => {
  it("склеивает реплики после нашего ответа (VWU5YU8)", () => {
    expect(buyerTailText([
      { role: "user", text: "Помогите" },
      { role: "assistant", text: "На каком шаге?" },
      { role: "user", text: "Что за создание геймпасса?" },
      { role: "user", text: "Я делаю дочке, она тоже не знает" },
      { role: "user", text: "Сейчас сделаем скрин" },
    ])).toBe("Что за создание геймпасса?\nЯ делаю дочке, она тоже не знает\nСейчас сделаем скрин");
  });
  it("пусто, если последнее слово наше", () => {
    expect(buyerTailText([{ role: "user", text: "a" }, { role: "assistant", text: "b" }])).toBe("");
  });
});

describe("plain — markdown-ссылки не доходят до покупателя", () => {
  it("снимает обрывок «](/)» в конце (GVD9W9H)", () => {
    expect(plain("доведём заказ до конца.](/)")).toBe("доведём заказ до конца.");
  });
  it("ссылка → текст и адрес", () => {
    expect(plain("Откройте [инструкцию](https://robloxbank.ru/guide)")).toBe("Откройте инструкцию https://robloxbank.ru/guide");
    expect(plain("см. [тут](/)")).toBe("см. тут");
  });
  it("обычные скобки не трогает", () => {
    expect(plain("код (5–7 цифр) [важно]")).toBe("код (5–7 цифр) [важно]");
  });
});

describe("humanRepliedRecently — человек ведёт чат, воркер только предлагает", () => {
  const now = Date.parse("2026-11-27T09:00:00Z");
  const at = (m: number) => new Date(now - m * 60_000);
  const bot = ["Понимаю. С телефона плейс не создать, поэтому есть два варианта"];
  it("ответ руками в кабинете WB (VWU5YU8 08:41)", () => {
    expect(humanRepliedRecently([{ text: "без пароля не получится зайти. Потом нужно будет создать геймпасс", sentAt: at(19), local: false }], bot, [], now)).toBe(true);
  });
  it("ответ из TG", () => { expect(humanRepliedRecently([], bot, [at(30)], now)).toBe(true); });
  it("свои тексты воркера, заглушка и синк — не человек", () => {
    expect(humanRepliedRecently([
      { text: "Понимаю. С телефона плейс не создать, поэтому есть два варианта: менеджер…", sentAt: at(5), local: false },
      { text: "Передали ваш вопрос коллеге — ответим здесь же, в этом чате.", sentAt: at(5), local: false },
      { text: "Спасибо, код доставки получен! Заказ подтверждён", sentAt: at(5), local: false },
    ], bot, [], now)).toBe(false);
  });
  it("старше 12 ч — воркер снова отвечает сам", () => {
    expect(humanRepliedRecently([{ text: "ручной ответ", sentAt: at(13 * 60), local: false }], bot, [at(13 * 60)], now)).toBe(false);
  });
  it("isAutoSellerText", () => { expect(isAutoSellerText("Ваш заказ выполнен: 500 R$")).toBe(true); expect(isAutoSellerText("без пароля не зайти")).toBe(false); });
});

import { replyHint } from "../wb-chat-ai";
describe("replyHint (27.11.2026, TM6MZJ3)", () => {
  const asked = { role: "assistant" as const, text: "[менеджер] Смену ника в заказе можем сделать мы. Пришлите, пожалуйста, ник Roblox" };
  it("одно слово после просьбы прислать ник — это ник", () => {
    expect(replyHint([asked, { role: "user", text: "ACMVPO" }], "TM6MZJ3")).toMatch(/НИК Roblox/);
  });
  it("код заказа — не ник", () => {
    expect(replyHint([asked, { role: "user", text: "TM6MZJ3" }], "TM6MZJ3")).toBeNull();
  });
  it("фраза — без подсказки", () => {
    expect(replyHint([asked, { role: "user", text: "а как его узнать?" }], "X")).toBeNull();
  });
  it("без просьбы — без подсказки", () => {
    expect(replyHint([{ role: "assistant", text: "Заказ выполнен" }, { role: "user", text: "ACMVPO" }], "X")).toBeNull();
  });
});

import { nickFactLine, nickFromReply } from "../wb-chat-ai";
describe("проверка ника из ответа (27.11.2026)", () => {
  const asked = { role: "assistant" as const, text: "Пришлите, пожалуйста, ник Roblox" };
  it("ник достаётся из ответа", () => {
    expect(nickFromReply([asked, { role: "user", text: "ACMVPO" }], "TM6MZJ3")).toBe("ACMVPO");
  });
  it("нет аккаунта → проверить написание", () => {
    expect(nickFactLine({ status: "user_not_found", nick: "x", expectedPrice: 1429 })).toMatch(/НЕТ/);
  });
  it("нет пасса → создать пасс нужной цены", () => {
    expect(nickFactLine({ status: "no_gamepasses", nick: "Acmvpo", expectedPrice: 1429, userId: 1, games: { visibility: "hidden" as never, count: 0 } }))
      .toMatch(/создать пасс ценой 1429/);
  });
});
