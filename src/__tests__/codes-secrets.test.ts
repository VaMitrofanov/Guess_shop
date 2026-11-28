import {
  activationCodeHmac,
  decryptActivationCode,
  encryptActivationCode,
  hashPayToken,
  isPayTokenShape,
  maskEmail,
  newCodeOrderPublicId,
  newPayToken,
} from "@/lib/codes/secrets";
import { buildReferralCookie, parseReferralCookie } from "@/lib/codes/referral";

const KEY = "a".repeat(64);

describe("activation code secrets", () => {
  const saved = { ...process.env };
  beforeAll(() => {
    process.env.ACTIVATION_CODE_ENCRYPTION_KEY = KEY;
    process.env.AUTH_SECRET = "test-auth-secret";
  });
  afterAll(() => {
    process.env = saved;
  });

  test("the envelope round-trips and never contains the code in clear text", () => {
    const envelope = encryptActivationCode("ABCD-1234-EFGH");
    expect(envelope).not.toContain("ABCD");
    expect(decryptActivationCode(envelope)).toBe("ABCD-1234-EFGH");
  });

  test("a tampered envelope is rejected", () => {
    const envelope = encryptActivationCode("ROBLOXCODE1");
    const parts = envelope.split(":");
    parts[4] = parts[4].slice(0, -2) + (parts[4].endsWith("A") ? "BB" : "AA");
    expect(() => decryptActivationCode(parts.join(":"))).toThrow();
  });

  test("HMAC ignores case, spaces and dashes so a duplicate cannot sneak in", () => {
    expect(activationCodeHmac("abcd-1234 efgh")).toBe(activationCodeHmac("ABCD1234EFGH"));
  });

  test("pay tokens are 256-bit, url-safe and stored only as a hash", () => {
    const token = newPayToken();
    expect(isPayTokenShape(token)).toBe(true);
    expect(hashPayToken(token)).not.toContain(token);
    expect(isPayTokenShape("short")).toBe(false);
    expect(isPayTokenShape(`${token}/../x`)).toBe(false);
  });

  test("order numbers avoid ambiguous characters", () => {
    for (let i = 0; i < 50; i += 1) expect(newCodeOrderPublicId()).toMatch(/^CODE-[2-9A-HJ-NP-Z]{8}$/);
  });

  test("the payer sees only a masked recipient email", () => {
    expect(maskEmail("masha.ivanova@gmail.com")).toBe("ma***@gmail.com");
    expect(maskEmail("a@x.ru")).toBe("a***@x.ru");
    expect(maskEmail(null)).toBeNull();
  });

  test("the referral cookie is signed: a forged timestamp or code is rejected", () => {
    const cookie = buildReferralCookie("abc234xy", 1_700_000_000_000);
    expect(parseReferralCookie(cookie)).toEqual({ code: "abc234xy", at: 1_700_000_000_000 });
    const [code, , sig] = cookie.split(".");
    expect(parseReferralCookie(`${code}.1600000000000.${sig}`)).toBeNull();
    expect(parseReferralCookie(`zzz234xy.1700000000000.${sig}`)).toBeNull();
    expect(parseReferralCookie("garbage")).toBeNull();
  });
});
