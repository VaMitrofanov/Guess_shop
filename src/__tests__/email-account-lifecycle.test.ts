import {
  consentIpHash,
  emailVerificationResultUrl,
  emailActionTokenHash,
  isEmailActionToken,
  PRIVACY_POLICY_VERSION,
  publicAppOrigin,
} from "@/lib/email-account-lifecycle";

describe("email account lifecycle primitives", () => {
  test("accepts only the fixed-size base64url bearer token", () => {
    expect(isEmailActionToken("a".repeat(43))).toBe(true);
    expect(isEmailActionToken("a".repeat(42))).toBe(false);
    expect(isEmailActionToken(`${"a".repeat(42)}+`)).toBe(false);
  });

  test("hashes tokens deterministically without persisting the bearer value", () => {
    expect(emailActionTokenHash("token")).toMatch(/^[a-f0-9]{64}$/);
    expect(emailActionTokenHash("token")).toBe(emailActionTokenHash("token"));
    expect(emailActionTokenHash("token")).not.toBe(emailActionTokenHash("other"));
  });

  test("creates a keyed, non-reversible IP evidence value", () => {
    expect(consentIpHash("203.0.113.10", "secret-a")).toMatch(/^[a-f0-9]{64}$/);
    expect(consentIpHash("203.0.113.10", "secret-a")).not.toBe(consentIpHash("203.0.113.10", "secret-b"));
    expect(consentIpHash("unknown", "secret-a")).toBeNull();
    expect(consentIpHash("203.0.113.10", "")).toBeNull();
  });

  test("uses an explicit policy version for append-only evidence", () => {
    expect(PRIVACY_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("rejects an internal or attacker-controlled origin for email links", () => {
    expect(publicAppOrigin("https://0.0.0.0:3000")).toBe("https://robloxbank.ru");
    expect(publicAppOrigin("https://evil.example/robloxbank.ru")).toBe("https://robloxbank.ru");
    expect(publicAppOrigin("https://www.robloxbank.ru/some/path")).toBe("https://www.robloxbank.ru");
    expect(publicAppOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  test("builds the verification result redirect from the trusted app origin", () => {
    expect(emailVerificationResultUrl("success", "https://0.0.0.0:3000").toString())
      .toBe("https://robloxbank.ru/email/verified?status=success");
  });
});
