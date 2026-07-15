import { normalizeLoginEmail, postLoginPath } from "@/lib/auth-navigation";

describe("web login navigation", () => {
  test("normalizes the same email shape used during registration", () => {
    expect(normalizeLoginEmail("  Owner@Example.RU ")).toBe("owner@example.ru");
  });

  test("routes administrators and customers to separate protected areas", () => {
    expect(postLoginPath("ADMIN")).toBe("/admin");
    expect(postLoginPath("USER")).toBe("/dashboard");
    expect(postLoginPath(undefined)).toBe("/dashboard");
  });
});
