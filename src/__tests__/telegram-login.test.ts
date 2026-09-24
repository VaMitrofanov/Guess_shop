import crypto from "crypto";
import { TelegramLoginPayload, verifyTelegramLogin } from "@/lib/telegram-login";

function signedPayload(token: string, overrides: Partial<TelegramLoginPayload> = {}): TelegramLoginPayload {
  const payload: TelegramLoginPayload = {
    id: "123456", first_name: "Иван", username: "ivan",
    auth_date: "1783900800", hash: "", ...overrides,
  };
  const check = Object.entries(payload).filter(([key, value]) => key !== "hash" && value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`).sort().join("\n");
  const secret = crypto.createHash("sha256").update(token).digest();
  payload.hash = crypto.createHmac("sha256", secret).update(check).digest("hex");
  return payload;
}

describe("Telegram Login Widget verification", () => {
  const token = "123:secret";
  const now = new Date("2026-07-13T00:01:00Z");

  it("accepts only a fresh provider-signed subject", () => {
    expect(verifyTelegramLogin(signedPayload(token), { botToken: token, now })?.subject).toBe("123456");
  });
  it("rejects tampering", () => {
    const payload = signedPayload(token); payload.id = "999";
    expect(verifyTelegramLogin(payload, { botToken: token, now })).toBeNull();
  });
  it("rejects stale and future authentication", () => {
    expect(verifyTelegramLogin(signedPayload(token, { auth_date: "1783890000" }), { botToken: token, now })).toBeNull();
    expect(verifyTelegramLogin(signedPayload(token, { auth_date: "1783900900" }), { botToken: token, now })).toBeNull();
  });
});
