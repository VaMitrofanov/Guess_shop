import { buildCompletedMessages, CODES_UPSELL_PLAIN } from "../completed-messages";
import { buildRobuxEtaWbChat, WB_CODES_ARTICLE } from "../robux-eta";
import { wbChatCompletedMessage } from "../wb-chat-notify";

/* ⚡ Допродажа кодов после выкупа (19.11.2026). */
describe("промо кодов после выкупа", () => {
  const base = { amount: 1000, nick: "Kid", isDirectOrder: false, bonusGrantedAt: null, codeUnclaimed: false, completedCount: 1, bonusBalance: 0, discountGranted: false };
  it("в боте — абзац и кнопка витрины кодов, при любом сценарии", () => {
    const m = buildCompletedMessages(base as never);
    expect(m.tgMsg2).toContain("roblox.com/redeem");
    expect(m.vkMsg2).toContain(CODES_UPSELL_PLAIN);
    expect(m.buttons.some((b) => b.command === "codes")).toBe(true);
  });
  it("в чате WB — только свой артикул, без ссылок и без сроков", () => {
    const eta = buildRobuxEtaWbChat([{ amount: 1000, completedAt: new Date(Date.now() - 3 * 86_400_000) }]);
    const done = wbChatCompletedMessage(1000, "Kid");
    for (const text of [eta?.text ?? "", done]) {
      expect(text).toContain(WB_CODES_ARTICLE);
      expect(text).not.toMatch(/https?:\/\/(?!www\.roblox)/);
      expect(text).not.toMatch(/robloxbank\.ru/);
    }
  });
});
