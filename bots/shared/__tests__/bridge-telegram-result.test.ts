jest.mock("../roblox", () => ({
  getGamepassDetailsDirect: jest.fn(),
  getUserGamepasses: jest.fn(),
  getGamepassForPurchase: jest.fn(),
}));

import { telegramProxySuccessPayload } from "../bridge";

describe("telegramProxySuccessPayload", () => {
  it("returns Telegram data for the read-only community methods", () => {
    expect(telegramProxySuccessPayload("getChat", { title: "RobloxBank" })).toEqual({
      ok: true,
      result: { title: "RobloxBank" },
    });
    expect(telegramProxySuccessPayload("getChatMemberCount", 310)).toEqual({
      ok: true,
      result: 310,
    });
  });

  // The id is the handle a caller needs to edit its own message later. Without
  // it the DBS live card could never find what it had sent and posted a fresh
  // message on every refresh — three identical cards for one order on 20.08.
  it("returns only the message id for a send, never the message itself", () => {
    expect(telegramProxySuccessPayload("sendMessage", {
      message_id: 42,
      text: "Код гейта: 7KA63QA",
      chat: { id: 85137352, username: "owner" },
      from: { id: 1, is_bot: true },
    })).toEqual({ ok: true, result: { message_id: 42 } });
  });

  it("does not expose Telegram response data for other mutating methods", () => {
    expect(telegramProxySuccessPayload("deleteMessage", true)).toEqual({ ok: true });
    expect(telegramProxySuccessPayload("editMessageText", { message_id: 42, text: "x" })).toEqual({ ok: true });
  });

  it("stays quiet when Telegram sent no id back", () => {
    expect(telegramProxySuccessPayload("sendMessage", undefined)).toEqual({ ok: true });
    expect(telegramProxySuccessPayload("sendMessage", { message_id: "42" })).toEqual({ ok: true });
  });
});
