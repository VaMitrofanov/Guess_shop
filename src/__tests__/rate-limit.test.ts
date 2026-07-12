import { clientIp, rateLimit } from "../lib/rate-limit";

describe("rateLimit", () => {
  it("allows the configured burst and then returns a positive retry window", () => {
    const key = `test-burst-${Date.now()}`;

    expect(rateLimit(key, 2, 0.5).ok).toBe(true);
    expect(rateLimit(key, 2, 0.5).ok).toBe(true);

    const blocked = rateLimit(key, 2, 0.5);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("prefers the stable client-IP headers over proxy fallbacks", () => {
    const req = new Request("https://example.test", {
      headers: {
        "cf-connecting-ip": "203.0.113.10",
        "x-forwarded-for": "198.51.100.20, 10.0.0.1",
      },
    });

    expect(clientIp(req)).toBe("203.0.113.10");
  });
});
