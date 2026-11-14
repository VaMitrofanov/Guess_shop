import { courierReplyText, isCourierQuestion } from "../wb-courier-reply";

describe("вопрос про курьера в чате WB", () => {
  it.each([
    "Когда приедет курьер?",
    "а доставка когда будет",
    "Где мой заказ??",
    "когда привезут",
    "в какой пвз придет",
    "как отследить заказ",
  ])("распознаёт: %s", (text) => expect(isCourierQuestion(text)).toBe(true));

  it.each([
    "123 456",
    "код 4837261 доставка",
    "Здравствуйте",
    "робуксы не пришли",
    "Ник Roblox: Misha2010",
  ])("не трогает: %s", (text) => expect(isCourierQuestion(text)).toBe(false));

  it("ответ объясняет, что курьера нет, и просит код текстом", () => {
    const text = courierReplyText();
    expect(text).toContain("Курьера не будет");
    expect(text).toContain("код доставки");
    expect(text).toContain("ТЕКСТОМ");
  });
});
