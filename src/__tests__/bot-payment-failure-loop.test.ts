/* Отказ подготовить оплату в боте (05.11.2026, VK).
   Покупательница прислала email — бот ответил «пасс уже выкуплен» и снова
   показал кнопки способов оплаты. Каждая вела к тому же email и тому же
   отказу. Неповторяемый отказ обязан вести к новой заявке, а email — не
   спрашиваться второй раз. */
import fs from "node:fs";
import path from "node:path";
import { BotPaymentApiError, isTerminalBotPaymentError } from "../../bots/shared/bot-payment-api";

const read = (file: string) => fs.readFileSync(path.join(__dirname, "..", "..", file), "utf8");

describe("отказ оплаты в боте", () => {
  it("пасс/срок/бонус/уже обработано — неповторяемые, сеть и реквизиты — повторяемые", () => {
    for (const code of ["GAMEPASS_CHANGED", "EXPIRED", "BENEFITS_CHANGED", "NOT_FOUND", "ALREADY_PROCESSED"]) {
      expect(isTerminalBotPaymentError(new BotPaymentApiError("x", code))).toBe(true);
    }
    expect(isTerminalBotPaymentError(new BotPaymentApiError("x", "CONFIGURATION"))).toBe(false);
    expect(isTerminalBotPaymentError(new BotPaymentApiError("x", null))).toBe(false);
    expect(isTerminalBotPaymentError(new Error("fetch failed"))).toBe(false);
  });

  it("API бота передаёт код отказа, который отдаёт сервер", () => {
    expect(read("src/app/api/internal/bot-payments/route.ts")).toContain("{ error: error.message, code: error.code }");
    expect(read("bots/shared/bot-payment-api.ts")).toContain("new BotPaymentApiError(");
  });

  it.each([
    ["bots/vk/handlers.ts", "replyVkPaymentFailure", "vkReceiptEmails"],
    ["bots/tg/handlers.ts", "replyTelegramPaymentFailure", "tgReceiptEmails"],
  ])("%s: неповторяемый отказ ведёт к новой заявке, email не спрашивается дважды", (file, reply, cache) => {
    const src = read(file);
    expect(src).toContain("isTerminalBotPaymentError(error)");
    expect(src).toContain("💎 Оформить заново");
    expect(src).toContain("✅ Email принят.");
    expect(src).toContain(`${cache}.set(`);
    expect(src).toContain(`${cache}.get(`);
    // Оба пути отказа (после email и по кнопке способа) идут через общий ответ.
    expect(src.split(`await ${reply}(`).length - 1).toBe(2);
  });
});
