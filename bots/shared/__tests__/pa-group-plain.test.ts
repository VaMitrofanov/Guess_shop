/** Ассистент беседы админов: ответ модели без markdown-мусора в Telegram. */
import { plain } from "../pa-ai-support";

describe("plain", () => {
  it("снимает жирный, заголовки и код", () => {
    expect(plain("По заказу **VV7AMZU**:\n## Итог\n`8SVDTAE`")).toBe("По заказу VV7AMZU:\nИтог\n8SVDTAE");
  });
});
