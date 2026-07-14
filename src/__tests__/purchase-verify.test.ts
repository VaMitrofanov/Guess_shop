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
afterEach(() => {
  global.fetch = realFetch;
});

describe("needsOwnershipCheck (оба зеркала)", () => {
  const cases: Array<[string | undefined, boolean]> = [
    ["InsufficientFunds", false],
    ["NotForSale", false],
    ["PriceChanged", false],
    ["CookieExpired", false],
    ["AlreadyOwned", true],   // отдельная ветка у вызывающих, но проверка не вредит
    ["Неизвестная ошибка", true],
    [undefined, true],        // сетевые/таймаут/нераспарсенный ответ
  ];

  test.each(cases)("reason=%p → %p", (reason, expected) => {
    expect(srcNeedsCheck(reason)).toBe(expected);
    expect(botsNeedsCheck(reason)).toBe(expected);
  });
});

describe("purchaseGamepassVerified (bots)", () => {
  test("провал без reason + владение подтверждено → recovered-успех", async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/purchases/products/")) {
        // нераспарсенный ответ → провал без каноничного reason
        return new Response("<html>gateway error</html>", { status: 200 });
      }
      if (url.includes("users/authenticated")) return jsonResponse({ id: 42, name: "Donor" });
      if (url.includes("inventory.roblox.com")) return jsonResponse({ data: [{ id: 1 }] });
      throw new Error(`unexpected fetch: ${url}`);
    }) as any;

    const result = await purchaseGamepassVerified(111, 143, 7, "cookie", "999", {
      firstMs: 5,
      retryMs: 5,
    });

    expect(result.success).toBe(true);
    expect(result.recovered).toBe(true);
    expect(result.price).toBe(143);
    expect(calls.some((u) => u.includes("inventory.roblox.com/v1/users/42/items/GamePass/999"))).toBe(true);
  });

  test("чистый отказ (InsufficientFunds) → провал без обращения к inventory", async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/purchases/products/")) {
        return jsonResponse({ purchased: false, reason: "InsufficientFunds" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as any;

    const result = await purchaseGamepassVerified(111, 143, 7, "cookie", "999", {
      firstMs: 5,
      retryMs: 5,
    });

    expect(result.success).toBe(false);
    expect(result.recovered).toBeUndefined();
    expect(calls.some((u) => u.includes("inventory.roblox.com"))).toBe(false);
  });

  test("провал с reason и без владения → остаётся провалом", async () => {
    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("/purchases/products/")) {
        return jsonResponse({ purchased: false, reason: "SomethingWeird" });
      }
      if (url.includes("users/authenticated")) return jsonResponse({ id: 42, name: "Donor" });
      if (url.includes("inventory.roblox.com")) return jsonResponse({ data: [] });
      throw new Error(`unexpected fetch: ${url}`);
    }) as any;

    const result = await purchaseGamepassVerified(111, 143, 7, "cookie", "999", {
      firstMs: 5,
      retryMs: 5,
    });

    expect(result.success).toBe(false);
    expect(result.recovered).toBeUndefined();
    expect(result.msg).toBe("SomethingWeird");
  });
});

describe("verifyGamepassOwnership (src-зеркало)", () => {
  test("владеет / не владеет / проверка недоступна", async () => {
    let inventory: unknown = { data: [{ id: 1 }] };
    let authOk = true;
    global.fetch = jest.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("users/authenticated")) {
        return authOk ? jsonResponse({ id: 42 }) : new Response("", { status: 401 });
      }
      if (url.includes("inventory.roblox.com")) return jsonResponse(inventory);
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
      expect(String(input)).toContain("apis.roblox.com/game-passes/v1/game-passes/999/product-info");
      expect(new Headers(init?.headers).get("Cookie")).toBe(".ROBLOSECURITY=secret-cookie");
      return jsonResponse({
        ProductId: 111,
        PriceInRobux: 1287,
        UserBasePriceInRobux: 1429,
        Name: "Regional pass",
        Creator: { Id: 42, Name: "Seller" },
        IsForSale: true,
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
    });
  });

  test("распознаёт typed Roblox Plus и не помечает его региональным", async () => {
    global.fetch = jest.fn(async () => jsonResponse({
      ProductId: 111,
      PriceInRobux: 2573,
      UserBasePriceInRobux: 2858,
      PriceDiscountDetails: [{
        Type: "RobloxPlusSubscription",
        AmountInRobux: 285,
        Percent: 10,
        EndTime: null,
      }],
      Creator: { Id: 42, Name: "Seller" },
      IsForSale: true,
    })) as any;

    const gp = await resolveGamepassForBuyer("999", "secret-cookie");
    expect(gp).toMatchObject({
      price: 2573,
      basePriceInRobux: 2858,
      robloxPlusDiscountPercent: 10,
      hasUnsafeBuyerPrice: false,
    });
  });

  test("не отправляет cookie в proxy fallback при ошибке official API", async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (input: any) => {
      calls.push(String(input));
      return new Response("", { status: 503 });
    }) as any;

    await expect(resolveGamepassForBuyer("999", "secret-cookie"))
      .rejects.toThrow("персональную цену Roblox");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("apis.roblox.com");
    expect(calls[0]).not.toContain("roproxy");
  });
});
