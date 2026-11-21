/**
 * Поиск по нику в ботах ходит НЕ напрямую в Roblox.
 *
 * С российского хоста API-хосты Roblox (`users`/`games`/`apis`/`thumbnails`)
 * недостижимы по TCP, а `rFetch` ботов даёт три попытки по 30 с. Прямой вызов
 * там означал полторы минуты ожидания и ответ «такого ника нет в Roblox» —
 * про существующий аккаунт. Мост стоит там, где Roblox доступен.
 */
const searchGamepassesByNickRouted = jest.fn();

jest.mock("../roblox", () => ({
  searchGamepassesByNickRouted: (...args: unknown[]) => searchGamepassesByNickRouted(...args),
}));

import { searchGamepassesByNick } from "../gamepass-search";

const pass = (id: number, robux: number) => ({
  gamepassId: id,
  productId: 0,
  placeId: 1818,
  name: `Pass ${id}`,
  robux,
  sellerName: "1212Angel2506",
  image: "https://tr.rbxcdn.com/x",
});

const account = { id: "7384307861", name: "1212Angel2506", displayName: "MIS", avatarUrl: null };

describe("searchGamepassesByNick", () => {
  beforeEach(() => searchGamepassesByNickRouted.mockReset());

  it("идёт маршрутизированным путём, а не напрямую в Roblox", async () => {
    searchGamepassesByNickRouted.mockResolvedValue({ account, gamepasses: [pass(1, 715)] });

    const result = await searchGamepassesByNick("1212Angel2506", 715);

    expect(searchGamepassesByNickRouted).toHaveBeenCalledWith("1212Angel2506");
    expect(result).toMatchObject({ status: "ok", userId: 7384307861 });
  });

  it("«такого ника нет» приходит только когда Roblox это подтвердил", async () => {
    searchGamepassesByNickRouted.mockResolvedValue({ account: null, gamepasses: [] });
    await expect(searchGamepassesByNick("zzz", 715)).resolves.toMatchObject({ status: "user_not_found" });

    // Аккаунт есть, пассов не видно — скрытый плейс. Это `no_gamepasses`, и
    // покупателя надо вести к ручной ссылке, а не к правке правильного ника.
    searchGamepassesByNickRouted.mockResolvedValue({ account, gamepasses: [] });
    await expect(searchGamepassesByNick("1212Angel2506", 715)).resolves.toMatchObject({
      status: "no_gamepasses",
      userId: 7384307861,
    });
  });

  it("разметка по цене не зависит от источника данных", async () => {
    searchGamepassesByNickRouted.mockResolvedValue({
      account,
      gamepasses: [pass(1, 100), pass(2, 716), pass(3, 715)],
    });

    const result = await searchGamepassesByNick("1212Angel2506", 715);
    if (result.status !== "ok") throw new Error("expected ok");

    expect(result.matches.map((g) => g.gamepassId)).toEqual([3, 2]);
    expect(result.nonMatches.map((g) => g.gamepassId)).toEqual([1]);
  });
});
