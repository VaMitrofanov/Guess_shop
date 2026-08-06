import { guideReleaseFingerprint, securityHeaders } from "../../next-security";

describe("Guide release fingerprint", () => {
  test("is deterministic and safe to expose as a response header", () => {
    expect(guideReleaseFingerprint()).toMatch(/^[a-f0-9]{16}$/);
    expect(guideReleaseFingerprint()).toBe(guideReleaseFingerprint());
  });

  test("is attached to shared Web and Guide response headers", async () => {
    const rules = await (securityHeaders as () => Promise<
      { source: string; headers: { key: string; value: string }[] }[]
    >)();
    const common = rules.find((rule) => rule.source === "/:path*");
    expect(common?.headers.find((header) => header.key === "X-RobloxBank-Guide-Release")?.value)
      .toBe(guideReleaseFingerprint());
  });
});
