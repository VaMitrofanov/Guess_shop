import { isSiteAcquiringEnabled } from "@/lib/site-acquiring";
import { isVkAuthEnabled } from "@/lib/vk-auth-availability";
import { RegisterSchema } from "@/lib/registration";

describe("public launch gates", () => {
  test("enables acquiring only for the exact value true", () => {
    expect(isSiteAcquiringEnabled("true")).toBe(true);
    expect(isSiteAcquiringEnabled("TRUE")).toBe(false);
    expect(isSiteAcquiringEnabled("1")).toBe(false);
    expect(isSiteAcquiringEnabled(undefined)).toBe(false);
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
