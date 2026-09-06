export {};

/**
 * Ветка «сделаем за тебя» на стороне ботов.
 *
 * Здесь два разных обещания, и оба проверяются:
 *   1. **Ключ никуда не утекает.** Ни в лог, ни в заметку заказа, ни в
 *      карточку админа. Утечка обнаруживается не по падению, а через месяц.
 *   2. **Пассы создаются по одному и по порядку**, а первый отказ останавливает
 *      набор: `create` не идемпотентен, и «попробовать ещё раз всё» рождает
 *      лишний пасс на чужом аккаунте.
 *
 * Сеть замокана: тест не ходит ни в Roblox, ни на мост.
 */

const createMock = jest.fn();
jest.mock("../roblox", () => ({
  createGamePassForUserRouted: (...args: unknown[]) => createMock(...args),
}));

import {
  createPassesByKey,
  looksLikeApiKey,
  recordAutocreateTrace,
} from "../gamepass-autocreate";

const KEY = "Oc567XuPVUmyo8yc0PP27WLic2c3NZcAhUStwG1vt9m8+PhA";

beforeEach(() => createMock.mockReset());

describe("looksLikeApiKey", () => {
  test("настоящий ключ проходит", () => expect(looksLikeApiKey(KEY)).toBe(true));

  test("отсекает то, что ключом быть не может, без похода в Roblox", () => {
    expect(looksLikeApiKey("привет")).toBe(false);            // короткое слово
    expect(looksLikeApiKey("https://roblox.com/very/long/url/here")).toBe(false);
    expect(looksLikeApiKey(`${KEY.slice(0, 20)} ${KEY.slice(20)}`)).toBe(false); // с пробелом
    expect(looksLikeApiKey("1234567")).toBe(false);           // код WB
  });
});

describe("createPassesByKey", () => {
  test("создаёт по одному и в порядке цен", async () => {
    createMock
      .mockResolvedValueOnce({ ok: true, gamePassId: 1, priceInRobux: 2143 })
      .mockResolvedValueOnce({ ok: true, gamePassId: 2, priceInRobux: 715 });

    const out = await createPassesByKey({ apiKey: KEY, nick: "Nick", targets: [2143, 715] });

    expect(out.error).toBeUndefined();
    expect(out.created.map((c) => c.gamePassId)).toEqual([1, 2]);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[0][0]).toMatchObject({ priceInRobux: 2143, username: "Nick" });
    expect(createMock.mock.calls[1][0]).toMatchObject({ priceInRobux: 715 });
  });

  test("первый отказ останавливает набор и возвращает уже созданное", async () => {
    createMock
      .mockResolvedValueOnce({ ok: true, gamePassId: 1, priceInRobux: 2143 })
      .mockResolvedValueOnce({ ok: false, error: "bad_scope" });

    const out = await createPassesByKey({ apiKey: KEY, nick: "Nick", targets: [2143, 715] });

    expect(out.error).toBe("bad_scope");
    expect(out.created).toHaveLength(1);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  test("больше двух пассов на заказ не создаём", async () => {
    createMock.mockResolvedValue({ ok: true, gamePassId: 1, priceInRobux: 100 });
    await createPassesByKey({ apiKey: KEY, nick: "Nick", targets: [100, 200, 300] });
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  test("ключ не печатается в лог ни при успехе, ни при отказе", async () => {
    const logs: string[] = [];
    const log = jest.spyOn(console, "log").mockImplementation((...a) => { logs.push(a.join(" ")); });
    const warn = jest.spyOn(console, "warn").mockImplementation((...a) => { logs.push(a.join(" ")); });

    createMock.mockResolvedValueOnce({ ok: true, gamePassId: 1, priceInRobux: 100 });
    await createPassesByKey({ apiKey: KEY, nick: "Nick", targets: [100] });
    createMock.mockResolvedValueOnce({ ok: false, error: "bad_key" });
    await createPassesByKey({ apiKey: KEY, nick: "Nick", targets: [100] });

    expect(logs.join("\n")).not.toContain(KEY);
    log.mockRestore();
    warn.mockRestore();
  });
});

describe("recordAutocreateTrace", () => {
  function client(order: Record<string, unknown> | null) {
    const events: unknown[] = [];
    const updates: unknown[] = [];
    const keys: unknown[] = [];
    return {
      events,
      updates,
      keys,
      db: {
        wbOrder: {
          findFirst: async () => order,
          update: async (args: unknown) => { updates.push(args); return {}; },
        },
        orderEvent: { create: async (args: unknown) => { events.push(args); return {}; } },
        robloxApiKey: {
          findUnique: async () => null,
          findFirst: async () => null,
          create: async (args: unknown) => { keys.push(args); return { id: "k1" }; },
          update: async (args: unknown) => { keys.push(args); return { id: "k1" }; },
        },
      },
    };
  }

  test("на каждый пасс — событие заказа, в заметку — строка с ID и ценой", async () => {
    process.env.WB_DELIVERY_ENCRYPTION_KEY = "a".repeat(64);
    const c = client({ id: "order_1", userId: "user_1", adminNote: null });

    await recordAutocreateTrace(c.db as never, {
      wbCode: "ABC1234",
      nick: "Nick",
      apiKey: KEY,
      created: [
        { gamePassId: 111, priceInRobux: 2143 },
        { gamePassId: 222, priceInRobux: 715 },
      ],
      partial: false,
    });

    expect(c.events).toHaveLength(2);
    const note = JSON.stringify(c.updates);
    expect(note).toContain("111");
    expect(note).toContain("2143");
    // Ключ в заметке заказа не появляется ни в каком виде: её видят все админы.
    expect(note).not.toContain(KEY);
  });

  test("ключ уходит в хранилище только зашифрованным", async () => {
    process.env.WB_DELIVERY_ENCRYPTION_KEY = "a".repeat(64);
    const c = client({ id: "order_1", userId: "user_1", adminNote: null });

    await recordAutocreateTrace(c.db as never, {
      wbCode: "ABC1234",
      nick: "Nick",
      apiKey: KEY,
      created: [{ gamePassId: 111, priceInRobux: 2143 }],
      partial: false,
    });

    expect(JSON.stringify(c.keys)).not.toContain(KEY);
  });

  test("заказа ещё нет — ключ сохраняем, событий не пишем, ничего не роняем", async () => {
    process.env.WB_DELIVERY_ENCRYPTION_KEY = "a".repeat(64);
    const c = client(null);

    await recordAutocreateTrace(c.db as never, {
      wbCode: "ABC1234",
      nick: "Nick",
      apiKey: KEY,
      created: [{ gamePassId: 111, priceInRobux: 2143 }],
      partial: false,
    });

    expect(c.events).toHaveLength(0);
    expect(c.keys).toHaveLength(1);
  });
});
