/**
 * Шаблоны ответов на вопросы WB (12.11.2026). Примеры — настоящие вопросы
 * покупателей с карточек, как они пришли (опечатки сохранены).
 */
import { classifyQuestion, passPriceFor, templateText, type QuestionTopic } from "../wb-question-templates";

const P500 = { nmId: 967446616, productName: "Карта пополнения 500 Robux Роблокс Робуксы" };
const CODE800 = { nmId: 1447864924, productName: "Карта пополнения 800 Robux Роблокс Робуксы" };
const topicOf = (text: string, card = P500) => classifyQuestion({ text, ...card })?.topics ?? null;

describe("код получения в вопросе — не публикуем", () => {
  it.each(["Код 001948", "595 081 код", "Здравствуйте я заказала 1000 робуксов код доставки:026 720", "Я оплатила. Код вот такой надо заказа?454420"])(
    "%s → reject",
    (text) => {
      const r = classifyQuestion({ text, ...P500 })!;
      expect(r.action).toBe("reject");
      expect(r.text).not.toMatch(/\d{6}/);
    },
  );
});

describe("жалобы и возвраты — человеку", () => {
  it.each([
    "у меня не пришли робуксы спустя 8 ДНЕЙ,что мне делать??",
    "почему девятый день пошёл, и роблоксов нету?",
    "а что делать если написала Ник и код в Ботаническом, сделала пасс, прошло 5 часов, ничего не идет",
    "Что делать когда говорят код не найден?",
    "вы почему мне в чате не отвечаете? кол доставки я вам предоставил уже",
    "Здравствуйте что делать? Купили ,всё сделали .но на старый аккаунт от которого у меня даже пароля нету.",
  ])("%s → ORDER_PROBLEM", (text) => {
    const r = classifyQuestion({ text, ...P500 })!;
    expect(r.action).toBe("human");
    expect(r.topic).toBe("ORDER_PROBLEM");
  });

  it("«верните деньги» — возврат, человеку", () => {
    expect(classifyQuestion({ text: "я нечего не понял верните деньги", ...P500 })).toMatchObject({ topic: "REFUND", action: "human" });
  });
});

describe("типовые вопросы — автоответ", () => {
  const cases: Array<[string, QuestionTopic[]]> = [
    ["через сколько придут робуксы?", ["WAIT_TIME"]],
    ["Здравствуйте, robux идут геймпассом или моментально?", ["GAMEPASS_OR_CODE", "WAIT_TIME"]],
    ["здравствуйте, написано что 100 робуксов в бонус, если я куплю 500 вы мне 600 отправите?", ["BONUS"]],
    ["Где чат товара ?", ["WHERE_CHAT"]],
    ["А почему написано что только курьером?", ["DELIVERY_FORMAT"]],
    ["Где заказ? Написано что доставлен но за дверью нету", ["DELIVERY_FORMAT"]],
    ["здравствуйте, а если не знаем пароля от Роблокса то всё равно получится активировать?", ["PASSWORD_SAFETY"]],
    ["а можно ли создать эти гейм пассы с аккаунтом роблокс kids?", ["DEVICE"]],
    ["Сколько дней можно не активировать у", ["SHELF_LIFE"]],
    ["Здравствуйте, в каком мессенджере связаться с ботом?", ["MESSENGER"]],
    ["Ребенок может сам активировать", ["CHILD"]],
    ["Создание геймпасса платное?", ["PASS_FREE"]],
    ["здравствуйте, а мой плейс может быть приватным? или обязательно общедоступным?", ["PLACE_PRIVATE"]],
    ["Здравствуй, а комиссию Роблокса вы на себя берете или нет?", ["COMMISSION"]],
    ["Когда будет в наличии 300 рб?", ["STOCK_PRICE"]],
  ];
  it.each(cases)("%s", (text, topics) => {
    const r = classifyQuestion({ text, ...P500 })!;
    expect(r.action).toBe("answer");
    expect(r.topics).toEqual(topics);
  });

  it("«вк» внутри слова не делает вопрос вопросом про мессенджер", () => {
    expect(topicOf("ждем карту с доставкой или сообщение?") ?? []).not.toContain("MESSENGER");
  });

  it("«подарочная карта» — это формат товара, а не бонус", () => {
    expect(topicOf("Здравствуйте, а робаксы придут через инет или в подарочной карте???")).toEqual(["DELIVERY_FORMAT"]);
  });
});

describe("тексты", () => {
  it("цена пасса считается от номинала карточки", () => {
    expect(passPriceFor(500)).toBe(715);
    expect(passPriceFor(1000)).toBe(1429);
    const r = classifyQuestion({ text: "сколько нужно поставить цену если должны прийти 500 робуксов?", ...P500 });
    expect(r?.text ?? "").toContain("715");
  });

  it("у кодовой карточки ответы про код, а не про геймпасс", () => {
    const r = classifyQuestion({ text: "сколько примерно нужно ждать ответ с кодом от продавца?", ...CODE800 })!;
    expect(r.topics).toEqual(["WAIT_TIME"]);
    expect(r.text).not.toMatch(/геймпасс/i);
  });

  it("ни один шаблон не содержит ссылок и внешних контактов (WB за это снимает ответы)", () => {
    const topics: QuestionTopic[] = [
      "CODE_IN_QUESTION", "REFUND", "ORDER_PROBLEM", "DELIVERY_FORMAT", "WHERE_CHAT", "HOW_TO_GET",
      "GAMEPASS_OR_CODE", "PASS_READY", "PASS_PRICE", "PASS_FREE", "PLACE_PRIVATE", "WAIT_TIME", "BONUS",
      "COMMISSION", "PASSWORD_SAFETY", "GIFT_OTHER", "CHILD", "DEVICE", "SHELF_LIFE", "MESSENGER", "STOCK_PRICE",
    ];
    for (const kind of ["gamepass", "code"] as const) {
      for (const t of topics) {
        const text = templateText(t, { kind, amount: 500 });
        expect(text).not.toMatch(/https?:|www\.|\.ru|telegram|t\.me|vk\.com|@/i);
        expect(text.length).toBeLessThanOrEqual(500);
      }
    }
  });

  it("пустой и бессмысленный вопрос — без ответа (человеку)", () => {
    expect(classifyQuestion({ text: "", ...P500 })).toBeNull();
    expect(classifyQuestion({ text: "Когда вергвься жерьги?", ...P500 })).toBeNull();
  });
});
