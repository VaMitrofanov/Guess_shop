import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  wbCodeRetryMessage,
  wbGateMessage,
  wbGateReminderMessage,
  wbGateUrl,
  wbGuideFallbackUrl,
} from "../../bots/shared/wb-gate-link";
import { redactWbChatText } from "../../bots/shared/wb-delivery-crypto";

describe("WB gate link handed to the buyer", () => {
  /** `skip=1` only skips the marketing intro; the guide ignores `code` unless
   * `skip` is set too, so a code-bearing link needs both. Regression: the DBS
   * gate used to send `skip=1` alone, making the buyer retype the code. */
  it("carries both skip and the code, like every other bot surface", () => {
    expect(wbGateUrl("QUN5YFZ")).toBe("https://robloxbank.ru/guide?source=wb&skip=1&code=QUN5YFZ");
  });

  it("honours a configured origin without doubling the slash", () => {
    expect(wbGateUrl("QUN5YFZ", "https://robloxbank.ru/")).toBe(
      "https://robloxbank.ru/guide?source=wb&skip=1&code=QUN5YFZ",
    );
  });

  it("keeps the guide's own contract intact", () => {
    const page = readFileSync(resolve(__dirname, "../app/guide/page.tsx"), "utf8");
    // The guide only reads `code` when `skip` is present — see wbCodeFromUrl.
    expect(page).toContain("const skipGate = isWB && !!skip;");
    expect(page).toContain("skipGate && code");
  });

  it("names the amount and repeats the code as a manual fallback", () => {
    const message = wbGateMessage("QUN5YFZ", 1000);
    // ru-RU groups thousands with a non-breaking space, so match loosely.
    expect(message).toMatch(/1\s000 R\$/);
    expect(message).toContain("https://robloxbank.ru/guide?source=wb&skip=1&code=QUN5YFZ");
    expect(message).toContain("введите код: QUN5YFZ");
    expect(wbGateMessage("QUN5YFZ", null)).toContain("ваш номинал");
  });

  /** Traefik routes on the query, so a fallback without `source=wb` never
   * reaches the guide container. */
  it("gives a fallback URL that actually resolves to the guide", () => {
    expect(wbGuideFallbackUrl()).toBe("https://robloxbank.ru/guide?source=wb");
    const message = wbGateMessage("QUN5YFZ", 1000);
    expect(message).toContain("https://robloxbank.ru/guide?source=wb и введите код");
    expect(message).not.toMatch(/(?<!\/)\brobloxbank\.ru\/guide(?!\?)/);
  });

  /** Wildberries penalises sellers who steer buyers to outside platforms, so
   * the chat message must name no messenger — the page does that. */
  it("names no messenger in the WB chat", () => {
    const message = wbGateMessage("QUN5YFZ", 1000);
    expect(message).not.toMatch(/telegram|телеграм|вконтакте|\bvk\b|\bтг\b/i);
  });

  /** Без геймпасса Robux зачислить физически нельзя — это половина инструкции,
   * а покупатель доходил до страницы с ожиданием «сейчас просто скажу ник». */
  it("warns that a game pass is part of the job, not just a nick", () => {
    for (const message of [wbGateMessage("QUN5YFZ", 1000), wbGateReminderMessage("QUN5YFZ", 1000, 1)]) {
      expect(message).toMatch(/геймпасс/i);
      expect(message).toMatch(/ник Roblox/);
    }
  });

  /** 20.08: WB отклонил код покупателя, а покупателю ушло «Заказ подтверждён».
   * Вместо гейта в таком случае уходит просьба прислать код заново — и она не
   * должна ни подтверждать заказ, ни выдавать какой-либо код. */
  it("asks for another delivery code without confirming anything", () => {
    const retry = wbCodeRetryMessage();
    expect(retry).toMatch(/не подошёл/i);
    expect(retry).toMatch(/Доставки/);
    expect(retry).not.toMatch(/подтверждён/i);
    expect(retry).not.toContain("robloxbank.ru");
    expect(retry).not.toMatch(/telegram|телеграм|вконтакте|\bvk\b/i);
  });

  /** Our seven-character activation code must not survive in the stored
   * transcript — including inside the link's query string. */
  it("is fully redacted before it reaches the chat history", () => {
    const stored = redactWbChatText(wbGateMessage("QUN5YFZ", 1000));
    expect(stored).not.toContain("QUN5YFZ");
    expect(stored).toContain("code=•••••••");
    expect(stored).toContain("введите код: •••••••");
  });
});
