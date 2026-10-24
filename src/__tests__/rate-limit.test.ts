import { clientIp, rateLimit, trustedProxyMode } from "../lib/rate-limit";

function reqWith(headers: Record<string, string>) {
  return new Request("https://example.test", { headers });
}

describe("rateLimit", () => {
  it("allows the configured burst and then returns a positive retry window", () => {
    const key = `test-burst-${Date.now()}`;

    expect(rateLimit(key, 2, 0.5).ok).toBe(true);
    expect(rateLimit(key, 2, 0.5).ok).toBe(true);

    const blocked = rateLimit(key, 2, 0.5);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThanOrEqual(1);
  });
});

describe("clientIp — режим direct (текущий прод, U2)", () => {
  const original = process.env.TRUSTED_PROXY_MODE;

  afterEach(() => {
    if (original === undefined) delete process.env.TRUSTED_PROXY_MODE;
    else process.env.TRUSTED_PROXY_MODE = original;
  });

  it("по умолчанию режим direct", () => {
    delete process.env.TRUSTED_PROXY_MODE;
    expect(trustedProxyMode()).toBe("direct");
  });

  it("игнорирует подделанный cf-connecting-ip и берёт hop нашего прокси", () => {
    delete process.env.TRUSTED_PROXY_MODE;
    const req = reqWith({
      "cf-connecting-ip": "203.0.113.10",
      "true-client-ip": "203.0.113.11",
      "x-forwarded-for": "198.51.100.20",
    });

    expect(clientIp(req)).toBe("198.51.100.20");
  });

  it("ключ ведра не меняется при ротации поддельных заголовков", () => {
    delete process.env.TRUSTED_PROXY_MODE;
    const keys = new Set<string>();
    for (let i = 0; i < 30; i++) {
      keys.add(
        clientIp(
          reqWith({
            "cf-connecting-ip": `203.0.113.${i}`,
            "x-forwarded-for": `198.51.100.${i}, 89.110.94.7`,
          })
        )
      );
    }
    expect([...keys]).toEqual(["89.110.94.7"]);
  });

  it("берёт последний hop цепочки, а не клиентский левый", () => {
    delete process.env.TRUSTED_PROXY_MODE;
    const req = reqWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 89.110.94.7" });
    expect(clientIp(req)).toBe("89.110.94.7");
  });

  it("падает на x-real-ip, когда x-forwarded-for нет", () => {
    delete process.env.TRUSTED_PROXY_MODE;
    expect(clientIp(reqWith({ "x-real-ip": "89.110.94.8" }))).toBe("89.110.94.8");
    expect(clientIp(reqWith({}))).toBe("unknown");
  });
});

describe("clientIp — режим cloudflare", () => {
  const original = process.env.TRUSTED_PROXY_MODE;

  beforeEach(() => {
    process.env.TRUSTED_PROXY_MODE = "cloudflare";
  });

  afterEach(() => {
    if (original === undefined) delete process.env.TRUSTED_PROXY_MODE;
    else process.env.TRUSTED_PROXY_MODE = original;
  });

  it("принимает cf-connecting-ip, когда ближайший hop — это Cloudflare", () => {
    const req = reqWith({
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "203.0.113.10, 172.68.1.1",
    });
    expect(clientIp(req)).toBe("203.0.113.10");
  });

  it("отвергает cf-connecting-ip, когда hop не из диапазонов Cloudflare", () => {
    const req = reqWith({
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "203.0.113.10, 198.51.100.77",
    });
    expect(clientIp(req)).toBe("198.51.100.77");
  });

  it("понимает IPv6-диапазоны Cloudflare", () => {
    const req = reqWith({
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "203.0.113.10, 2606:4700:0:1::abcd",
    });
    expect(clientIp(req)).toBe("203.0.113.10");
  });
});
