/**
 * Скрытый плейс — это про видимость, а не про продажу.
 *
 * Пасс живёт внутри игры. Игру можно не показывать миру (новый аккаунт получает
 * приватный плейс по умолчанию), и тогда каталог Roblox о пассе молчит, а
 * страница пасса отдаёт 404 — хотя сам пасс существует и выставлен на продажу.
 * Раньше мы читали это молчание как «пасс недоступен» и отказывали покупателю:
 * 13.09.2026 на заказе `K56B6EX` так был отвергнут пасс, который наш же бот
 * только что создал ключом покупательницы.
 *
 * Решение владельца 13.09.2026: выкуп у нас ручной, поэтому достаточно, чтобы
 * ПЕРВОИСТОЧНИК Roblox подтвердил «в продаже» и цену. Защита от УДАЛЁННОГО
 * пасса при этом сохраняется: она держится не на каталоге, а на том, что
 * первоисточник об удалённом пассе не знает — поэтому спрашиваем именно
 * `apis.roblox.com`, а не кэширующее зеркало roproxy.
 */

const GP = "1980050799";
const CREATOR_ID = 11626027474;

/** Ответ Roblox в форме `product-info` (её отдают и зеркало, и первоисточник). */
function productInfo(isForSale: boolean) {
  return {
    TargetId: Number(GP),
    ProductId: 3712603423,
    Name: "RobloxBank",
    Creator: { Id: CREATOR_ID, Name: "Margoritka3616" },
    PriceInRobux: 1429,
    IsForSale: isForSale,
    Created: new Date().toISOString(),
  };
}

const json = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } }) as unknown as Response;

/**
 * Мир скрытого плейса: каталог и маркетплейс пусты, универс не резолвится,
 * публичных игр у создателя нет. Меняется только ответ ПЕРВОИСТОЧНИКА.
 */
function mockRobloxWorld(directForSale: boolean | "unreachable") {
  return jest.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("marketplace-items/v1/items/details")) return json([]);
    if (url.includes("catalog.roblox.com/v1/catalog/items/details")) return json({ data: [] });
    if (url.includes("economy.roblox.com")) return json({}, 404);
    if (url.includes("apis.roproxy.com") && url.includes("product-info")) return json(productInfo(true));
    if (url.includes("apis.roblox.com") && url.includes("product-info")) {
      return directForSale === "unreachable" ? json({}, 404) : json(productInfo(directForSale));
    }
    if (url.includes("universes/v1/assets/")) return json({}, 404); // универс не разрешился
    if (url.includes("/games?")) return json({ data: [] }); // публичных игр нет
    if (url.includes("usernames/users")) return json({ data: [] });
    return json({}, 404);
  });
}

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });

describe("пасс в скрытой игре", () => {
  it("остаётся активным, когда первоисточник подтверждает продажу и цену", async () => {
    global.fetch = mockRobloxWorld(true) as unknown as typeof fetch;
    const { getGamepassDetailsDirect } = await import("../roblox");

    const details = await getGamepassDetailsDirect(GP);

    expect(details).toMatchObject({ isActive: true, price: 1429, creatorName: "Margoritka3616" });
    // Признак остаётся — он нужен карточке админа и разбору, но отказом больше не служит.
    expect(details?.isGamePrivate).toBe(true);
    expect(details?.isNotInCatalog).toBeFalsy();
    // Скрытую игру нельзя называть возрастным ограничением: 18+ — это отдельный
    // ответ Roblox, а не «мы её не увидели».
    expect(details?.isAgeRestricted).toBeFalsy();
  });

  it("остаётся отказом, когда первоисточник о пассе не знает (удалён)", async () => {
    global.fetch = mockRobloxWorld("unreachable") as unknown as typeof fetch;
    jest.resetModules();
    const { getGamepassDetailsDirect } = await import("../roblox");

    const details = await getGamepassDetailsDirect(GP);

    expect(details?.isActive).toBe(false);
    expect(details?.isNotInCatalog || details?.isGamePrivate).toBe(true);
  });

  it("не верит зеркалу: продажу подтверждает только apis.roblox.com", async () => {
    global.fetch = mockRobloxWorld(false) as unknown as typeof fetch;
    jest.resetModules();
    const { getGamepassDetailsDirect } = await import("../roblox");

    const details = await getGamepassDetailsDirect(GP);

    // Зеркало говорит «в продаже», первоисточник — «нет»: верим первоисточнику.
    expect(details?.isActive).toBe(false);
  });
});
