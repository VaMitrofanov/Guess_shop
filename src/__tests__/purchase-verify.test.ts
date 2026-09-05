/**
 * Ф1 — контрольная проверка владения после ошибки выкупа.
 * Тестируются оба зеркала (bots/shared/roblox.ts и src/lib/roblox-buyout.ts):
 * решение-функция «ошибка → нужна ли проверка» и recovered-путь с мок-fetch.
 */
import {
  needsOwnershipCheck as srcNeedsCheck,
  resolveGamepassForBuyer,
  verifyGamepassOwnership as srcVerifyOwnership,
} from "../lib/roblox-buyout";
import {
  needsOwnershipCheck as botsNeedsCheck,
  purchaseGamepassVerified,
} from "../../bots/shared/roblox";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const realFetch = global.fetch;
beforeEach(() => {
  process.env.ROBLOX_PURCHASE_SERVICE_URL = "http://purchase-service.test:9223";
  process.env.ROBLOX_PURCHASE_SERVICE_TOKEN = "t".repeat(32);
});
afterEach(() => {
  global.fetch = realFetch;
  delete process.env.ROBLOX_PURCHASE_SERVICE_URL;
  delete process.env.ROBLOX_PURCHASE_SERVICE_TOKEN;
});

const sessionResponse = () => jsonResponse({
  ok: true,
  code: "OK",
  session: { accountId: 42, accountName: "Donor", balance: 500 },
});

const preflightResponse = (overrides: Record<string, unknown> = {}) => jsonResponse({
  ok: true,
  code: "OK",
  session: { accountId: 42, accountName: "Donor", balance: 500 },
  gamepass: {
    gamepassId: 999,
    productId: 111,
    name: "Pass",
    price: 143,
    basePriceInRobux: 143,
    priceDiscountDetails: [],
    sellerName: "Seller",
    sellerId: 42,
    isForSale: true,
    owned: false,
    ...overrides,
  },
});

describe("needsOwnershipCheck (оба зеркала)", () => {
  const cases: Array<[string | undefined, boolean]> = [
    ["InsufficientFunds", false],
    ["NotForSale", false],
    ["PriceChanged", false],
    ["CookieExpired", false],
    ["AlreadyOwned", false],  // reuse/ownership — ручной разбор, не recovered-успех
    ["BrowserUnavailable: service down", false],
    ["BalanceMismatch: delta 0", false],
    ["Неизвестная ошибка", true],
    [undefined, true],        // сетевые/таймаут/нераспарсенный ответ
  ];

  test.each(cases)("reason=%p → %p", (reason, expected) => {
    expect(srcNeedsCheck(reason)).toBe(expected);
    expect(botsNeedsCheck(reason)).toBe(expected);
  });
});

describe("purchaseGamepassVerified (bots)", () => {
  test("успешный browser transport возвращает подтверждённую цену", async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (input: any, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/session")) return sessionResponse();
      if (url.endsWith("/purchase")) {
        const body = JSON.parse(String(init?.body));
        expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${"t".repeat(32)}`);
        expect(body).toMatchObject({ cookie: "cookie", gamepassId: "999", expectedBuyerId: 42, expectedPrice: 143 });
        expect(body.script).toContain("startGamepassPurchaseFlow");
        return jsonResponse({ purchased: true, reason: "OK", price: 143, balanceBefore: 500, balanceAfter: 357 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as any;

    const result = await purchaseGamepassVerified(111, 143, 7, "cookie", "999");

    expect(result.success).toBe(true);
    expect(result.recovered).toBeUndefined();
    expect(result.price).toBe(143);
    expect(calls.some((u) => u.includes("purchase-service.test"))).toBe(true);
  });

  test("недоступный browser service → провал без обращения к inventory", async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/session")) return sessionResponse();
      if (url.endsWith("/purchase")) throw new Error("connect ECONNREFUSED");
      throw new Error(`unexpected fetch: ${url}`);
    }) as any;

    const result = await purchaseGamepassVerified(111, 143, 7, "cookie", "999");

    expect(result.success).toBe(false);
    expect(result.recovered).toBeUndefined();
    expect(result.reason).toMatch(/BrowserUnavailable/);
    expect(calls.some((u) => u.includes("inventory.roblox.com"))).toBe(false);
  });

  test("ownership без точной дельты баланса не превращается в recovered-успех", async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/session")) return sessionResponse();
      if (url.endsWith("/purchase")) {
        return jsonResponse({
          purchased: false,
          reason: "BalanceMismatch: владение подтверждено, дельта 0 R$, ожидалось 143 R$",
          ownedAfter: true,
          balanceBefore: 500,
          balanceAfter: 500,
        }, 409);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as any;

    const result = await purchaseGamepassVerified(111, 143, 7, "cookie", "999");

    expect(result.success).toBe(false);
    expect(result.recovered).toBeUndefined();
    expect(result.msg).toMatch(/BalanceMismatch/);
    expect(calls.some((u) => u.includes("inventory.roblox.com"))).toBe(false);
  });
});

describe("verifyGamepassOwnership (src-зеркало)", () => {
  test("владеет / не владеет / проверка недоступна", async () => {
    let inventory: unknown = { data: [{ id: 1 }] };
    let authOk = true;
    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      if (url.endsWith("/gamepass-preflight")) {
        if (!authOk) return jsonResponse({ ok: false, code: "DONOR_COOKIE_INVALID", reason: "NotLoggedIn" }, 409);
        const owned = Array.isArray((inventory as any)?.data) ? (inventory as any).data.length > 0 : null;
        return preflightResponse({ owned });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as any;

    expect(await srcVerifyOwnership("cookie", 999)).toBe(true);

    inventory = { data: [] };
    expect(await srcVerifyOwnership("cookie", 999)).toBe(false);

    inventory = { nonsense: true }; // нераспознанный ответ → null
    expect(await srcVerifyOwnership("cookie", 999)).toBe(null);

    authOk = false; // авторизация недоступна → null
    expect(await srcVerifyOwnership("cookie", 999)).toBe(null);
  });
});

describe("resolveGamepassForBuyer (regional pricing)", () => {
  test("читает buyer-specific цену с cookie, сохраняя базу продавца", async () => {
    global.fetch = jest.fn(async (input: any, init?: RequestInit) => {
      expect(String(input)).toBe("http://purchase-service.test:9223/gamepass-preflight");
      expect(new Headers(init?.headers).get("Cookie")).toBeNull();
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ cookie: "secret-cookie", gamepassId: "999", source: "web" });
      return preflightResponse({
        price: 1287,
        basePriceInRobux: 1429,
        name: "Regional pass",
      });
    }) as any;

    const gp = await resolveGamepassForBuyer("999", "secret-cookie");
    expect(gp).toMatchObject({
      productId: 111,
      price: 1287,
      basePriceInRobux: 1429,
      isManagedPricing: true,
      hasUnsafeBuyerPrice: true,
      robloxPlusDiscountPercent: null,
      sellerId: 42,
      isForSale: true,
      buyerAccountId: 42,
      buyerAccountName: "Donor",
      buyerBalance: 500,
    });
  });

  test("распознаёт typed Roblox Plus и не помечает его региональным", async () => {
    global.fetch = jest.fn(async () => preflightResponse({
      price: 2573,
      basePriceInRobux: 2858,
      priceDiscountDetails: [{
        Type: "RobloxPlusSubscription",
        AmountInRobux: 285,
        Percent: 10,
        EndTime: null,
      }],
    })) as any;

    const gp = await resolveGamepassForBuyer("999", "secret-cookie");
    expect(gp).toMatchObject({
      price: 2573,
      basePriceInRobux: 2858,
      robloxPlusDiscountPercent: 10,
      hasUnsafeBuyerPrice: false,
    });
  });

  test("не отправляет cookie в Roblox/proxy при ошибке browser service", async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (input: any) => {
      calls.push(String(input));
      return jsonResponse({ ok: false, code: "BROWSER_SERVICE_UNAVAILABLE", reason: "BrowserUnavailable" }, 503);
    }) as any;

    await expect(resolveGamepassForBuyer("999", "secret-cookie"))
      .rejects.toThrow("Браузерный сервис выкупа недоступен");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("http://purchase-service.test:9223/gamepass-preflight");
  });
});
