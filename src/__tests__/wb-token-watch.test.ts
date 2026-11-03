jest.mock("../../bots/shared/db", () => ({ db: {} }));
import { wbTokenExpiry, wbTokenLevel, wbTokenNotice, wbTokenShouldWarn } from "../../bots/shared/wb-token-watch";

const jwt = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.sig`;
const DAY = 86_400_000;
const now = new Date("2026-11-01T00:00:00Z");
const at = (days: number) => new Date(now.getTime() + days * DAY);

describe("сторож срока токена WB", () => {
  it("срок читается из JWT, мусор — null", () => {
    expect(wbTokenExpiry(jwt(1793493599))?.toISOString()).toBe("2026-11-01T00:39:59.000Z");
    expect(wbTokenExpiry("не-токен")).toBeNull();
    expect(wbTokenExpiry(undefined)).toBeNull();
  });

  it("пороги 14 / 7 / 3 / 1 и «истёк»", () => {
    expect(wbTokenLevel(at(30), now)).toBeNull();
    expect(wbTokenLevel(at(13), now)).toBe(14);
    expect(wbTokenLevel(at(6.5), now)).toBe(7);
    expect(wbTokenLevel(at(2), now)).toBe(3);
    expect(wbTokenLevel(at(0.5), now)).toBe(1);
    expect(wbTokenLevel(at(-0.01), now)).toBe(0);
  });

  it("один раз на порог, заново — для нового токена, по истёкшему — раз в 12 ч", () => {
    const exp = at(6);
    expect(wbTokenShouldWarn(7, null, exp, now)).toBe(true);
    expect(wbTokenShouldWarn(7, { level: 7, exp: exp.toISOString() }, exp, now)).toBe(false);
    expect(wbTokenShouldWarn(3, { level: 7, exp: exp.toISOString() }, exp, now)).toBe(true);
    expect(wbTokenShouldWarn(14, { level: 1, exp: "2026-01-01T00:00:00.000Z" }, exp, now)).toBe(true);
    expect(wbTokenShouldWarn(null, null, exp, now)).toBe(false);
    const sent = new Date(now.getTime() - 13 * 3600_000).toISOString();
    expect(wbTokenShouldWarn(0, { level: 0, exp: exp.toISOString(), sentAt: sent }, exp, now)).toBe(true);
    const recent = new Date(now.getTime() - 3600_000).toISOString();
    expect(wbTokenShouldWarn(0, { level: 0, exp: exp.toISOString(), sentAt: recent }, exp, now)).toBe(false);
  });

  it("сообщение не содержит токена и говорит, что делать", () => {
    const text = wbTokenNotice("WB_API_TOKEN", at(0), 0);
    expect(text).toContain("истёк");
    expect(text).toContain("Доступ к API");
    expect(text).not.toMatch(/eyJ/);
  });
});
