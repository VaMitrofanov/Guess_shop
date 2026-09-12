import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { wbCodeRecheckMessage, wbCodeRequestMessage, wbCodeRetryMessage } from "../../bots/shared/wb-gate-link";

function read(relative: string) {
  return readFileSync(resolve(__dirname, "../..", relative), "utf8");
}

/** Owner-approved text, 16.08.2026; формат кода добавлен 10.09.2026. Kept
 * verbatim so the auto-reply, the console button and anything sent by hand from
 * the WB cabinet read the same. */
const APPROVED = `Здравствуйте! Для успешного получения заказа просим прислать код доставки — это 5-7 цифр в разделе "Доставки" приложения Wildberries, рядом с QR-кодом.
Код необходимо направить в этот чат ТЕКСТОМ, ровно так, как он показан в приложении: 111 111 или 111111. Скриншот или фото кода мы прочитать не сможем.
Доставка заказов осуществляется Онлайн через этот чат, без необходимости физической доставки, курьера Вам ждать не нужно`;

describe("WB delivery-code request message", () => {
  it("matches the owner-approved wording exactly", () => {
    expect(wbCodeRequestMessage()).toBe(APPROVED);
  });

  /** Код вынимается из ТЕКСТА сообщения; фото для нас пустое, и заказ на нём
   * встаёт молча. Оба написания примера — потому что `extractDeliveryCode`
   * принимает и с пробелом, и слитно, и покупатель не должен выбирать. */
  it("asks for text, not a screenshot, and shows both spellings", () => {
    const msg = wbCodeRequestMessage();
    expect(msg).toContain("ТЕКСТОМ");
    expect(msg).toMatch(/скриншот/i);
    expect(msg).toContain("111 111");
    expect(msg).toContain("111111");
  });

  /** WB отгружал коды в пять, шесть и семь цифр — столько же принимает
   * `extractDeliveryCode`. Обещать «5-6» значит сказать владельцу
   * семизначного кода, что у него не тот код. */
  it("names the same length range the parser accepts", () => {
    for (const msg of [wbCodeRequestMessage(), wbCodeRetryMessage(), wbCodeRecheckMessage()]) {
      expect(msg).toContain("5-7 цифр");
      expect(msg).not.toContain("5-6");
    }
  });

  it("names no messenger — WB penalises steering buyers off-platform", () => {
    expect(wbCodeRequestMessage()).not.toMatch(/telegram|телеграм|вконтакте|\bvk\b/i);
  });

  it("is the single source for both the auto-reply and the console button", () => {
    const worker = read("bots/shared/wb-delivery-sync.ts");
    const console_ = read("src/lib/wb-delivery-workflow.ts");
    expect(worker).toContain("wbCodeRequestMessage()");
    expect(console_).toContain("wbCodeRequestMessage()");
    // Neither surface may keep its own copy of the wording.
    expect(worker).not.toContain("Здравствуйте! Для успешного получения");
    expect(console_).not.toContain("Здравствуйте! Для успешного получения");
  });

  it("keeps the auto-reply behind its own flag and the global chat-send flag", () => {
    const worker = read("bots/shared/wb-delivery-sync.ts");
    expect(worker).toContain('process.env.WB_DBS_AUTO_REPLY !== "true"');
    expect(worker).toContain('process.env.WB_CHAT_SEND_ENABLED !== "true"');
  });

  /** A duplicate greeting is worse than a missing one, so the send must be
   * claimed by a CAS on chatState before the request leaves. */
  it("claims the order before sending so it can only greet once", () => {
    const worker = read("bots/shared/wb-delivery-sync.ts");
    const fn = worker.slice(worker.indexOf("async function tryAutoRequestCode"));
    const claim = fn.indexOf('chatState: { in: ["WAITING_BUYER_CHAT", "READY"] }');
    const send = fn.indexOf("sendBuyerChatMessage");
    expect(claim).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(claim);
    expect(fn).toContain("if (claimed.count !== 1) return;");
  });
});
