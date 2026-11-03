import { buildTelegramWebLoginUrl, parseTelegramWebLoginStart } from "../../bots/shared/telegram-web-login";
import { verifyTelegramLogin } from "@/lib/telegram-login";

describe("Telegram bot-assisted web login", () => {
  const state = "a".repeat(32);
  const token = "123:secret";
  const now = new Date("2026-07-15T15:00:00Z");

  test("accepts only bounded login and link start payloads", () => {
    expect(parseTelegramWebLoginStart(`web_login_${state}`)).toEqual({ mode: "login", state });
    expect(parseTelegramWebLoginStart(`web_link_${state}`)).toEqual({ mode: "link", state });
    expect(parseTelegramWebLoginStart("web_login_short")).toBeNull();
    expect(parseTelegramWebLoginStart(`wb_${state}`)).toBeNull();
  });

  test("builds a provider-signed callback that the site verifies", () => {
    const url = new URL(buildTelegramWebLoginUrl(
      { id: 123456, first_name: "Иван", last_name: "Тест", username: "ivan" },
      "login",
      state,
      { botToken: token, baseUrl: "https://robloxbank.ru", now },
    ));
    const payload = {
      id: url.searchParams.get("id")!,
      first_name: url.searchParams.get("first_name")!,
      last_name: url.searchParams.get("last_name")!,
      username: url.searchParams.get("username")!,
      auth_date: url.searchParams.get("auth_date")!,
      hash: url.searchParams.get("hash")!,
    };

    expect(url.pathname).toBe("/auth/telegram/callback");
    expect(url.searchParams.get("state")).toBe(state);
    expect(verifyTelegramLogin(payload, { botToken: token, now })?.subject).toBe("123456");
  });
});
