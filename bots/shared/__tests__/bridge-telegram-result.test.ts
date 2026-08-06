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

  it("does not expose Telegram response data for mutating methods", () => {
    expect(telegramProxySuccessPayload("sendMessage", { message_id: 42 })).toEqual({ ok: true });
    expect(telegramProxySuccessPayload("deleteMessage", true)).toEqual({ ok: true });
  });
});
