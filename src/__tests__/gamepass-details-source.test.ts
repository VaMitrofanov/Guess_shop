import { getGamepassDetails } from "../lib/roblox";

/**
 * Поиск ОДНОГО геймпасса по ссылке/ID держится на `product-info`.
 *
 * 24.08.2026 на прод-хосте проверены все прежние источники `getGamepassDetails`:
 * `game-passes/v1/game-passes/<id>` → 404, `economy…/details` → 404,
 * `catalog/items/details` → 403 «XSRF token invalid», `api.roblox.com/marketplace`
 * мёртв давно. Поиск по НИКУ этого не замечал (он ходит в
 * `universes/<id>/game-passes`), поэтому дыра была невидимой: ссылка на геймпасс
 * молча резолвилась в «не найден», а серверная ре-валидация заказа всё время шла
 * по ветке «Roblox недоступен». Тест фиксирует живой источник и разбор его полей.
 */
describe("getGamepassDetails", () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  const productInfo = {
    TargetId: 1955617429,
    Name: "Joost",
    Creator: { Id: 2548828272, Name: "kiiruxaa", CreatorTargetId: 2548828272 },
    PriceInRobux: 1715,
    IsForSale: true,
  };

  function mockFetch(handler: (url: string) => { ok: boolean; body?: unknown }) {
    const calls: string[] = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const { ok, body } = handler(url);
      return { ok, status: ok ? 200 : 404, json: async () => body } as Response;
    }) as unknown as typeof fetch;
    return calls;
  }

  test("спрашивает product-info первым и читает цену, продажу и владельца", async () => {
    const calls = mockFetch((url) =>
      url.includes("/product-info") ? { ok: true, body: productInfo } : { ok: false });

    const details = await getGamepassDetails("1955617429");

    expect(calls[0]).toContain("/game-passes/v1/game-passes/1955617429/product-info");
    expect(details).toMatchObject({
      id: "1955617429",
      name: "Joost",
      price: 1715,
      creatorId: 2548828272,
      creatorName: "kiiruxaa",
      isActive: true,
    });
  });

  test("снятый с продажи пасс: PriceInRobux = null не притворяется бесплатным заказом", async () => {
    mockFetch((url) =>
      url.includes("/product-info")
        ? { ok: true, body: { ...productInfo, PriceInRobux: null, IsForSale: false } }
        : { ok: false });

    const details = await getGamepassDetails("1954951455");
    expect(details?.isActive).toBe(false);
    expect(details?.price).toBe(0);
  });

  test("мёртвые источники не выдают геймпасс за найденный", async () => {
    mockFetch(() => ({ ok: false }));
    expect(await getGamepassDetails("1")).toBeNull();
  });
});
