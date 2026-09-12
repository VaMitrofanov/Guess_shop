/**
 * Хранение Open Cloud-ключей покупателей.
 *
 * Владелец решил ключи НЕ стирать (ими чинится уже созданный пасс и ускоряется
 * следующий заказ). Значит, единственное, что здесь нельзя сломать молча, —
 * это способ хранения: в базу уходит шифртекст, а не ключ, и один и тот же ключ
 * не плодит строк.
 */

const rows: Record<string, Record<string, unknown>> = {};
const mockFindUnique = jest.fn();
const mockFindFirst = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    robloxApiKey: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

import { loadRobloxApiKey, rememberRobloxApiKey, robloxApiKeyStoreReady } from "@/lib/roblox-api-key-store";

const KEY = "Oc567XuPVUmyo8yc0PP27WLic2c3NZcAhUStwG1vt9m8+PhA";
const realEnv = process.env;

beforeEach(() => {
  process.env = { ...realEnv, WB_DELIVERY_ENCRYPTION_KEY: "a".repeat(64) };
  for (const k of Object.keys(rows)) delete rows[k];
  mockFindUnique.mockReset().mockResolvedValue(null);
  mockFindFirst.mockReset().mockResolvedValue(null);
  mockCreate.mockReset().mockImplementation(async (args: { data: Record<string, unknown> }) => {
    rows[String(args.data.keyHmac)] = args.data;
    return { id: "key_1", ...args.data };
  });
  mockUpdate.mockReset().mockResolvedValue({});
});

afterAll(() => {
  process.env = realEnv;
});

describe("rememberRobloxApiKey", () => {
  test("в базу уходит шифртекст, а не ключ", async () => {
    const result = await rememberRobloxApiKey({
      key: KEY,
      robloxUsername: "Mono262910",
      orderId: "ord_1",
      result: "ok",
      createdPasses: 2,
    });

    expect(result).toBe("saved");
    const data = mockCreate.mock.calls[0][0].data as Record<string, string>;
    expect(JSON.stringify(data)).not.toContain(KEY);
    expect(data.encryptedValue).toMatch(/^v1:roblox-api-key:/);
    // Ник — ключ поиска, поэтому нижним регистром.
    expect(data.robloxUsername).toBe("mono262910");
    expect(data.createdPasses).toBe(2);
  });

  test("тот же ключ второй раз не плодит строк — обновляет след", async () => {
    await rememberRobloxApiKey({ key: KEY, robloxUsername: "mono262910", result: "ok", createdPasses: 1 });
    const hmac = (mockCreate.mock.calls[0][0].data as Record<string, string>).keyHmac;
    mockFindUnique.mockResolvedValue({ id: "key_1", createdPasses: 1 });

    const second = await rememberRobloxApiKey({ key: KEY, robloxUsername: "mono262910", result: "ok", createdPasses: 1 });

    expect(second).toBe("updated");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUpdate.mock.calls[0][0].where).toEqual({ id: "key_1" });
    expect(mockUpdate.mock.calls[0][0].data.useCount).toEqual({ increment: 1 });
    // HMAC детерминирован — иначе дедупликация не сработала бы вовсе.
    expect(hmac).toHaveLength(64);
  });

  test("без ключа шифрования ничего не сохраняем (и не падаем)", async () => {
    process.env = { ...realEnv, WB_DELIVERY_ENCRYPTION_KEY: "" };
    expect(robloxApiKeyStoreReady()).toBe(false);
    await expect(rememberRobloxApiKey({ key: KEY, robloxUsername: "mono262910", result: "ok" })).resolves.toBe("skipped");
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("loadRobloxApiKey", () => {
  test("возвращает исходный ключ (round-trip через шифр)", async () => {
    await rememberRobloxApiKey({ key: KEY, robloxUsername: "mono262910", result: "ok" });
    const stored = mockCreate.mock.calls[0][0].data as Record<string, string>;
    mockFindFirst.mockResolvedValue({
      id: "key_1",
      robloxUsername: "mono262910",
      encryptedValue: stored.encryptedValue,
      lastUsedAt: null,
      createdPasses: 0,
    });

    const loaded = await loadRobloxApiKey("MONO262910");
    expect(loaded?.key).toBe(KEY);
  });

  test("ключа нет — null, а не исключение", async () => {
    await expect(loadRobloxApiKey("nobody")).resolves.toBeNull();
  });
});
