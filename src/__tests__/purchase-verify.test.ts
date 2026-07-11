/**
 * Ф1 — контрольная проверка владения после ошибки выкупа.
 * Тестируются оба зеркала (bots/shared/roblox.ts и src/lib/roblox-buyout.ts):
 * решение-функция «ошибка → нужна ли проверка» и recovered-путь с мок-fetch.
 */
import {
  needsOwnershipCheck as srcNeedsCheck,
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
