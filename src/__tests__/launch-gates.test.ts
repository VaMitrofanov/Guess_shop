import {
  isSiteAcquiringEnabled,
  parseSiteAcquiringMode,
  siteAcquiringBucket,
  siteAcquiringDecision,
} from "@/lib/site-acquiring";
import { isVkAuthEnabled } from "@/lib/vk-auth-availability";
import { RegisterSchema } from "@/lib/registration";

describe("public launch gates", () => {
  test("enables acquiring only for the exact value true", () => {
    expect(isSiteAcquiringEnabled("true")).toBe(true);
    expect(isSiteAcquiringEnabled("TRUE")).toBe(false);
    expect(isSiteAcquiringEnabled("1")).toBe(false);
    expect(isSiteAcquiringEnabled(undefined)).toBe(false);
  });

  test("keeps the rollout fail-closed unless a valid mode is explicit", () => {
    expect(parseSiteAcquiringMode(undefined)).toBe("off");
    expect(parseSiteAcquiringMode("ON")).toBe("off");
    expect(siteAcquiringDecision({ userId: "u1", masterFlag: "true" }).eligible).toBe(false);
    expect(siteAcquiringDecision({ userId: "u1", masterFlag: "false", mode: "on" }).eligible).toBe(false);
    expect(siteAcquiringDecision({ userId: null, masterFlag: "true", mode: "on" }).eligible).toBe(false);
  });

  test("supports an exact internal-user allowlist", () => {
    const input = { masterFlag: "true", mode: "allowlist", allowlist: "u1, u2" };
    expect(siteAcquiringDecision({ ...input, userId: "u2" }).eligible).toBe(true);
    expect(siteAcquiringDecision({ ...input, userId: "buyer@example.ru" }).eligible).toBe(false);
  });

  test("assigns percentage rollout deterministically", () => {
    const userId = "stable-customer-id";
    const bucket = siteAcquiringBucket(userId);
    expect(siteAcquiringBucket(userId)).toBe(bucket);
    expect(siteAcquiringDecision({ userId, masterFlag: "true", mode: "percentage", percentage: String(bucket) }).eligible).toBe(false);
    expect(siteAcquiringDecision({ userId, masterFlag: "true", mode: "percentage", percentage: String(bucket + 1) }).eligible).toBe(true);
  });

  test("keeps VK ID hidden until the exact public flag is enabled", () => {
    expect(isVkAuthEnabled("true")).toBe(true);
    expect(isVkAuthEnabled("false")).toBe(false);
    expect(isVkAuthEnabled(undefined)).toBe(false);
  });

  test("requires explicit privacy consent for email registration", () => {
    const base = { email: "buyer@example.ru", password: "safe-password", name: "Buyer" };
    expect(RegisterSchema.safeParse({ ...base, agreedToPrivacy: true }).success).toBe(true);
    expect(RegisterSchema.safeParse(base).success).toBe(false);
    expect(RegisterSchema.safeParse({ ...base, agreedToPrivacy: false }).success).toBe(false);
  });
});
