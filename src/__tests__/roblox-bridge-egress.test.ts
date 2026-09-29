import { searchGamepassesByNick, getGamepassById, getGamepassDetails } from "../lib/roblox";

/**
 * С российского прод-хоста прямой путь до API-хостов Roblox мёртв: `users`,
 * `games`, `apis` и `thumbnails`.roblox.com живут на сети Roblox `128.116.0.0/16`,
 * и TCP до неё не устанавливается — соединение висит до таймаута. Замерено
 * 27.08.2026: поиск по нику на сайте отвечал 25 с и «такого пользователя нет»
 * про существующий аккаунт (три попытки по 8 с в `rFetch`), в ботах — те же
 * три попытки по 30 с, то есть полторы минуты до того же неверного ответа.
 *
 * Лечится маршрутом: мост стоит там, где Roblox доступен. Тесты держат ровно
 * то, на чём это ломалось раньше и сломается снова, если источник перепутать.
 */
describe("Roblox egress через мост", () => {
  const realFetch = global.fetch;
  const realUrl = process.env.VALIDATOR_SOURCE_URL;
  const realKey = process.env.VALIDATOR_KEY;

  afterEach(() => {
    global.fetch = realFetch;
    if (realUrl === undefined) delete process.env.VALIDATOR_SOURCE_URL;
    else process.env.VALIDATOR_SOURCE_URL = realUrl;
    if (realKey === undefined) delete process.env.VALIDATOR_KEY;
    else process.env.VALIDATOR_KEY = realKey;
  });

  function mockFetch(handler: (url: string) => { ok: boolean; status?: number; body?: unknown }) {
    const calls: string[] = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const { ok, status, body } = handler(url);
      return { ok, status: status ?? (ok ? 200 : 404), json: async () => body } as Response;
    }) as unknown as typeof fetch;
    return calls;
  }

  const bridgePass = {
    gamepassId: 1907029789,
    productId: 3622980917,
    placeId: 1818,
    name: "Vip1",
    robux: 715,
    sellerName: "1212Angel2506",
    image: "https://tr.rbxcdn.com/vip1",
  };

  test("поиск по нику не трогает Roblox напрямую, когда мост настроен", async () => {
    process.env.VALIDATOR_SOURCE_URL = "http://bridge.test:3000";
    process.env.VALIDATOR_KEY = "k";
    const calls = mockFetch(() => ({
      ok: true,
      body: {
        ok: true,
        userExists: true,
        account: { id: "7384307861", name: "1212Angel2506", displayName: "MIS", avatarUrl: "https://tr.rbxcdn.com/head" },
        gamepasses: [bridgePass],
      },
    }));

    const result = await searchGamepassesByNick("1212Angel2506");

    expect(calls).toEqual(["http://bridge.test:3000/search-gamepasses"]);
    expect(calls.some((url) => url.includes("roblox.com"))).toBe(false);
    expect(result.userExists).toBe(true);
    expect(result.account).toMatchObject({ id: "7384307861", username: "1212Angel2506", displayName: "MIS" });
    expect(result.gamepasses).toEqual([
      expect.objectContaining({ id: 1907029789, name: "Vip1", price: 715, placeId: 1818, isForSale: true }),
    ]);
  });

  test("«ника нет» и «пассов нет» остаются разными ответами", async () => {
    process.env.VALIDATOR_SOURCE_URL = "http://bridge.test:3000";
    mockFetch(() => ({ ok: true, body: { ok: true, userExists: false, account: null, gamepasses: [] } }));
    await expect(searchGamepassesByNick("zzz")).resolves.toMatchObject({ userExists: false, account: null });

    mockFetch(() => ({
      ok: true,
      body: {
        ok: true,
        userExists: true,
        account: { id: "7384307861", name: "1212Angel2506", displayName: "MIS", avatarUrl: null },
        gamepasses: [],
      },
    }));
    // Скрытый плейс: аккаунт реален, список пуст. Обвинить покупателя в опечатке
    // здесь — значит увести его от единственного рабочего выхода, ручной ссылки.
    await expect(searchGamepassesByNick("1212Angel2506")).resolves.toMatchObject({
      userExists: true,
      gamepasses: [],
    });
  });

  test("старый мост без account: пассы приехали — значит аккаунт есть", async () => {
    process.env.VALIDATOR_SOURCE_URL = "http://bridge.test:3000";
    // Мост, ещё не знающий про `/roblox-user`, отдаёт один список. Требовать
    // карточку аккаунта здесь значило бы отвечать «такого ника нет» на успешный
    // поиск — ровно то, что случилось бы при выкатке Web раньше моста.
    mockFetch(() => ({ ok: true, body: { ok: true, gamepasses: [bridgePass] } }));

    await expect(searchGamepassesByNick("1212Angel2506")).resolves.toMatchObject({
      userExists: true,
      account: null,
      gamepasses: [expect.objectContaining({ id: 1907029789 })],
    });
  });

  test("мост не ответил — идём напрямую, а не отдаём «пользователь не найден»", async () => {
    process.env.VALIDATOR_SOURCE_URL = "http://bridge.test:3000";
    const calls = mockFetch((url) => {
      if (url.includes("bridge.test")) throw new Error("connect ETIMEDOUT");
      if (url.includes("users.roblox.com/v1/usernames/users")) {
        return { ok: true, body: { data: [{ id: 1, name: "Roblox", displayName: "Roblox" }] } };
      }
      if (url.includes("games.roblox.com")) return { ok: true, body: { data: [] } };
      if (url.includes("thumbnails.roblox.com")) return { ok: true, body: { data: [{ imageUrl: "https://tr.rbxcdn.com/head" }] } };
      return { ok: false };
    });

    const result = await searchGamepassesByNick("Roblox");

    expect(calls[0]).toContain("bridge.test");
    expect(calls.some((url) => url.includes("users.roblox.com"))).toBe(true);
    // Ровно одна попытка моста на весь поиск: `getRobloxUser`/`getRobloxAvatar`
    // тоже ходят через мост, и наивный фолбэк утраивал ожидание там, где оно и
    // так самое длинное.
    expect(calls.filter((url) => url.includes("bridge.test"))).toHaveLength(1);
    expect(result).toMatchObject({ userExists: true, account: { username: "Roblox" } });
  });

  test("заглушка «Roblox недоступен» из моста не выдаётся за проверенный пасс", async () => {
    process.env.VALIDATOR_SOURCE_URL = "http://bridge.test:3000";
    // Мост отвечает `validationSkipped`, когда сам не смог подтвердить пасс.
    // Для бота это «пусть админ проверит руками», для сайта — оплата пасса,
    // цену и владельца которого не проверил никто. Здесь это отсутствие данных.
    const calls = mockFetch((url) => {
      if (url.includes("/check-pass")) {
        return {
          ok: true,
          body: {
            ok: true,
            data: { id: "1", name: "Неизвестно (Roblox недоступен)", price: 0, creatorId: 0, isActive: true, validationSkipped: true },
          },
        };
      }
      return { ok: false };
    });

    await expect(getGamepassDetails("1")).resolves.toBeNull();
    expect(calls.some((url) => url.includes("/check-pass"))).toBe(true);
  });

  test("ссылка на геймпасс собирает владельца и состояние продажи из ответа моста", async () => {
    process.env.VALIDATOR_SOURCE_URL = "http://bridge.test:3000";
    mockFetch((url) =>
      url.includes("/gamepass-by-id")
        ? {
            ok: true,
            body: {
              ok: true,
              gamepass: bridgePass,
              details: { id: "1907029789", name: "Vip1", price: 715, creatorId: 7384307861, creatorName: "1212Angel2506", isActive: false },
            },
          }
        : { ok: false });

    // Снятый с продажи пасс обязан доехать до страницы как «снят с продажи»:
    // молчаливое «не найден» здесь и было тупиком ручного ввода ссылки.
    await expect(getGamepassById("1907029789")).resolves.toMatchObject({
      id: "1907029789",
      name: "Vip1",
      price: 715,
      creatorId: 7384307861,
      creatorName: "1212Angel2506",
      isForSale: false,
      image: "https://tr.rbxcdn.com/vip1",
    });
  });

  test("без моста ничего не меняется — прямой путь как был", async () => {
    delete process.env.VALIDATOR_SOURCE_URL;
    const calls = mockFetch((url) => {
      if (url.includes("users.roblox.com/v1/usernames/users")) {
        return { ok: true, body: { data: [{ id: 1, name: "Roblox", displayName: "Roblox" }] } };
      }
      if (url.includes("games.roblox.com")) return { ok: true, body: { data: [] } };
      if (url.includes("thumbnails.roblox.com")) return { ok: true, body: { data: [{ imageUrl: "https://tr.rbxcdn.com/head" }] } };
      return { ok: false };
    });

    await searchGamepassesByNick("Roblox");

    expect(calls.every((url) => url.includes("roblox.com"))).toBe(true);
  });
});
