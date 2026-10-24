import { postLoginPath, safeReturnPath } from "@/lib/auth-navigation";

describe("authentication return navigation", () => {
  test("keeps a checkout draft on the same origin", () => {
    expect(safeReturnPath("/checkout?amount=500&username=Builder")).toBe("/checkout?amount=500&username=Builder");
  });

  test("rejects external, malformed and privileged redirects", () => {
    expect(safeReturnPath("https://evil.example/collect")).toBe("/dashboard");
    expect(safeReturnPath("//evil.example/collect")).toBe("/dashboard");
    expect(safeReturnPath("/\\evil.example/collect")).toBe("/dashboard");
    expect(safeReturnPath("/admin/users")).toBe("/dashboard");
  });

  test("never redirects an administrator into a customer draft", () => {
    expect(postLoginPath("ADMIN", "/checkout?amount=500")).toBe("/admin");
    expect(postLoginPath("USER", "/checkout?amount=500")).toBe("/checkout?amount=500");
  });
});
