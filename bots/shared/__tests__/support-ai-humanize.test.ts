jest.mock("../db", () => ({ db: {} }));

import { guardDecision, humanizeReply, refundGoesToWb, stripTimingPromises, type PaAiDecision } from "../pa-ai-support";
import { buyoutDelayText } from "../robux-wait";

const reply = (text: string, extra: Partial<PaAiDecision> = {}): PaAiDecision =>
  ({ action: "reply", category: "order_status", reply: text, summary: "", draft: "", ...extra });

describe("сроки из ответа ИИ вырезаются (27.11.2026)", () => {
  it.each([
    "Заказ JLQZUXG сейчас в очереди на выкуп, обычно это занимает до суток.",
    "Обычно выкуп идёт в течение дня.",
    "Робуксы зачисляются в течение суток.",
    "Выкупим сегодня.",
    "Через пару часов всё будет.",
  ])("«%s»", (s) => {
    expect(stripTimingPromises(`Видим ваш заказ. ${s} Как выкупим — напишем.`)).toBe("Видим ваш заказ. Как выкупим — напишем.");
  });

  it("срок Pending у Roblox остаётся", () => {
    const t = "Roblox держит робуксы до 30 дней, у части — 5–7 дней. Roblox снимет заморозку в течение 30 дней.";
    expect(stripTimingPromises(t)).toBe(t);
  });

  it("текст про медленный выкуп без сроков", () => {
    expect(stripTimingPromises(buyoutDelayText())).toBe(buyoutDelayText());
    expect(buyoutDelayText()).toMatch(/Roblox меняет правила/);
  });

  it("guard режет срок, но ответ уходит", () => {
    const d = guardDecision(reply("Заказ в очереди. Обычно выкуп идёт в течение дня."), "долго ещё?", "wb_chat");
    expect(d.action).toBe("reply");
    expect(d.reply).toBe("Заказ в очереди.");
  });
});

describe("живость ответа", () => {
  it("второй раз не здоровается", () => {
    expect(humanizeReply("Здравствуйте, Марина! Скриншот видим.", { greeted: true })).toBe("Скриншот видим.");
    expect(humanizeReply("Здравствуйте! Вот ссылка.", { greeted: true })).toBe("Вот ссылка.");
    expect(humanizeReply("Иван, здравствуйте. Заказ в очереди.", { greeted: true })).toBe("Заказ в очереди.");
    expect(humanizeReply("Здравствуйте, вот ссылка.", { greeted: true })).toBe("Вот ссылка.");
  });

  it("первым сообщением приветствие остаётся", () => {
    expect(humanizeReply("Здравствуйте! Чем помочь?")).toBe("Здравствуйте! Чем помочь?");
  });

  it("одно «пожалуйста»", () => {
    expect(humanizeReply("Пожалуйста, пришлите, пожалуйста, скриншот.")).toBe("Пожалуйста, пришлите скриншот.");
    expect(humanizeReply("Подскажите, пожалуйста, пожалуйста, ник.")).toBe("Подскажите, пожалуйста, ник.");
  });
});

describe("возврат: WB — отвечает сам, наш платёж — человеку", () => {
  const wbAnswer = reply("Возврат за заказ с Wildberries оформляется в самом Wildberries.", { category: "refund" });
  it("чат WB", () => {
    expect(guardDecision(wbAnswer, "Верните деньги", "wb_chat").action).toBe("reply");
  });
  it("ВК, все заказы с WB", () => {
    expect(guardDecision(wbAnswer, "хочу возврат", "vk_bot", { refundViaWb: true }).action).toBe("reply");
  });
  it("ВК, прямой заказ — человеку", () => {
    expect(guardDecision(wbAnswer, "хочу возврат", "vk_bot", { refundViaWb: false }).action).toBe("escalate");
  });
  it("угроза судом — всегда человеку", () => {
    expect(guardDecision(reply("Понимаем."), "подам в суд", "wb_chat").action).toBe("escalate");
  });
  it("refundGoesToWb", () => {
    expect(refundGoesToWb([{ isDirectOrder: false }])).toBe(true);
    expect(refundGoesToWb([{ isDirectOrder: true }])).toBe(false);
    expect(refundGoesToWb([{ isDirectOrder: false }], ["код"])).toBe(false);
    expect(refundGoesToWb([])).toBe(false);
  });
});

import { chatsAwaitingReply, eventTextForAi, latestBuyerImageId, wbChatImageIds } from "../wb-chat-ai";

describe("чат WB: скриншоты доходят до ИИ (27.11.2026)", () => {
  const now = Date.parse("2026-11-26T16:05:00Z");
  const ev = (id: string, sender: string, minAgo: number, text: string | null, imageIds: string[] = []) => ({
    id, wbEventId: id, chatId: "c1", sender, textRedacted: text, containsDeliveryCode: false,
    sentAt: new Date(now - minAgo * 60_000), marketplaceOrderId: "o1",
    attachmentsMeta: { images: imageIds.length, imageIds },
  });

  it("картинка без текста — ждёт ответа", () => {
    const e = ev("e1", "client", 3, null, ["2acb0ffa-d443-4395-a7fc-c453c13a694f"]);
    expect(eventTextForAi(e)).toBe("[прислал скриншот]");
    expect(chatsAwaitingReply([e], now)).toHaveLength(1);
  });

  it("скрин, а следом «вот» — берём картинку из хвоста покупателя", () => {
    const events = [
      ev("s1", "seller", 20, "Пришлите скриншот", ["old-seller-image-0001"]),
      ev("c1", "client", 6, null, ["2acb0ffa-d443-4395-a7fc-c453c13a694f"]),
      ev("c2", "client", 5, "Вот что открылось после входа"),
    ];
    expect(latestBuyerImageId(events, "c1")).toBe("2acb0ffa-d443-4395-a7fc-c453c13a694f");
  });

  it("после нашего ответа старая картинка не берётся", () => {
    const events = [ev("c1", "client", 10, null, ["2acb0ffa-d443-4395-a7fc-c453c13a694f"]), ev("s1", "seller", 8, "Видим"), ev("c2", "client", 5, "спасибо")];
    expect(latestBuyerImageId(events, "c1")).toBeNull();
  });

  it("downloadID из события WB", () => {
    expect(wbChatImageIds([{ date: "x", url: "", downloadID: "2acb0ffa-d443-4395-a7fc-c453c13a694f" }, { url: "" }, "junk"]))
      .toEqual(["2acb0ffa-d443-4395-a7fc-c453c13a694f"]);
  });
});

describe("без «Понимаем» в начале (28.11.2026)", () => {
  const { humanizeReply } = jest.requireActual("../pa-ai-support") as typeof import("../pa-ai-support");
  it("срезает первое предложение-сочувствие", () => {
    expect(humanizeReply("Понимаем, ждать неприятно. Заказ в очереди на выкуп.")).toBe("Заказ в очереди на выкуп.");
    expect(humanizeReply("Понимаю. С телефона плейс не создать.")).toBe("С телефона плейс не создать.");
  });
  it("одно предложение — не трогаем смысл", () => {
    expect(humanizeReply("Понимаем, что товар не подошёл")).toBe("Понимаем, что товар не подошёл");
  });
});
