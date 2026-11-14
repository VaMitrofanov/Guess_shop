/**
 * Ответ «где мой заказ» в чате поддержки @RobloxBank_PA (12.11.2026).
 * Фразы — настоящие вопросы покупателей.
 */
import { isOrderStatusQuestion, paOrderReply, type PaOrder } from "../pa-business-reply";

const NOW = new Date("2026-11-12T12:00:00Z");
const o = (over: Partial<PaOrder> = {}): PaOrder => ({
  wbCode: "ZT8BW8D", amount: 500, status: "PENDING", createdAt: new Date("2026-11-11T10:00:00Z"),
  completedAt: null, heldAt: null, ...over,
});

describe("isOrderStatusQuestion", () => {
  it.each([
    "где мои робуксы я из заказывала а мне они не идут",
    "отправила код,когда придут робоксы?",
    "долго ждать?",
    "у меня не пришли робуксы спустя 8 ДНЕЙ,что мне делать??",
    "все сделала,но пасс не купили что делать?",
    "Где заказ?",
  ])("вопрос о заказе: %s", (text) => expect(isOrderStatusQuestion(text)).toBe(true));

  it.each([
    "будут ли 100 робуксов в подарок?",
    "здравствуйте,а они придут с комиссией?",
    "А как создать гейм пас? Я сначала должна заказать, а потом придёт по шаговая инструкция?",
    "почему не приходит обещенный бонус?",
    "Не приходит смс. Что делать",
    "спасибо, всё пришло!",
    "я нечего не понял верните деньги",
  ])("не про статус: %s", (text) => expect(isOrderStatusQuestion(text)).toBe(false));
});

describe("paOrderReply", () => {
  it("заказ в очереди — этап и код заказа", () => {
    const r = paOrderReply("где мой заказ?", [o()], NOW)!;
    expect(r).toContain("ZT8BW8D");
    expect(r).toContain("в очереди на выкуп");
  });

  it("ждёт геймпасс — подсказка, что делать", () => {
    expect(paOrderReply("когда придут робуксы?", [o({ status: "AWAITING_GAMEPASS" })], NOW)).toContain("ждёт геймпасс");
  });

  it("выкуплен недавно — про Pending у Roblox", () => {
    const r = paOrderReply("робуксы не пришли", [o({ status: "COMPLETED", completedAt: new Date("2026-11-10T10:00:00Z") })], NOW)!;
    expect(r).toContain("Pending");
  });

  it("заморожен, ошибка, оплата, несколько живых, нет заказов — молчим (человеку)", () => {
    expect(paOrderReply("где заказ?", [o({ heldAt: NOW })], NOW)).toBeNull();
    expect(paOrderReply("где заказ?", [o({ status: "ERROR" })], NOW)).toBeNull();
    expect(paOrderReply("где заказ?", [o({ status: "PAYMENT_PENDING" })], NOW)).toBeNull();
    expect(paOrderReply("где заказ?", [o(), o({ wbCode: "SECOND1" })], NOW)).toBeNull();
    expect(paOrderReply("где заказ?", [], NOW)).toBeNull();
  });

  it("выкуп старше 30 дней — не «в пути», молчим", () => {
    expect(paOrderReply("робуксы не пришли", [o({ status: "COMPLETED", completedAt: new Date("2026-09-01T10:00:00Z") })], NOW)).toBeNull();
  });

  it("не вопрос о заказе — молчим даже при живом заказе", () => {
    expect(paOrderReply("будут ли 100 робуксов в подарок?", [o()], NOW)).toBeNull();
  });
});
