/**
 * Игры аккаунта — публичные И закрытые.
 *
 * 21.09.2026: из 52 застрявших заказов у 38 не было ни одной публичной игры, и
 * поиск по нику отвечал «пассов нет», а создание по ключу — «не нашли твою
 * игру». У 9 при этом уже стоял пасс ровно по цене заказа. Закрытые игры видны
 * через инвентарь плейсов; не видны они только при закрытом инвентаре, и тогда
 * ответ обязан быть «не видим», а не «нет».
 */

import {
  isSellablePass,
  listOwnedUniverses,
  listUniversePasses,
  parseExperienceRef,
  type JsonGet,
} from "../roblox-owned-games";

type Route = (url: string) => { status: number; body: unknown } | null;

function fakeGet(route: Route): { get: JsonGet; calls: string[] } {
  const calls: string[] = [];
  const get: JsonGet = async (url) => {
    calls.push(url);
    const hit = route(url);
    if (!hit) return null;
    return { ok: hit.status >= 200 && hit.status < 300, status: hit.status, body: hit.body };
  };
  return { get, calls };
}

const PUBLIC_EMPTY = { status: 200, body: { data: [], nextPageCursor: null } };

describe("listOwnedUniverses", () => {
  it("находит закрытую игру через инвентарь плейсов", async () => {
    const { get } = fakeGet((url) => {
      if (url.includes("/games?accessFilter=Public")) return PUBLIC_EMPTY;
      if (url.includes("inventory/9")) return { status: 200, body: { data: [{ assetId: 108336608135295 }] } };
      if (url.includes("places/108336608135295/universe")) return { status: 200, body: { universeId: 10457317927 } };
      return { status: 404, body: {} };
    });
    const owned = await listOwnedUniverses(11240332845, get);
    expect(owned.visibility).toBe("ok");
    expect(owned.universes).toEqual([{ universeId: "10457317927", placeId: 108336608135295, source: "inventory" }]);
  });

  it("не дублирует публичную игру, которая лежит и в инвентаре", async () => {
    const { get, calls } = fakeGet((url) => {
      if (url.includes("/games?accessFilter=Public")) {
        return { status: 200, body: { data: [{ id: 555, rootPlace: { id: 777 } }], nextPageCursor: null } };
      }
      if (url.includes("inventory/9")) return { status: 200, body: { data: [{ assetId: 777 }, { assetId: 888 }] } };
      if (url.includes("places/888/universe")) return { status: 200, body: { universeId: 999 } };
      return { status: 404, body: {} };
    });
    const owned = await listOwnedUniverses(1, get);
    expect(owned.universes.map((u) => u.universeId)).toEqual(["555", "999"]);
    // Корневой плейс публичной игры второй раз не резолвим.
    expect(calls.some((url) => url.includes("places/777/universe"))).toBe(false);
  });

  it("закрытый инвентарь и ноль публичных игр — «не видим» (hidden), а не «нет»", async () => {
    const { get } = fakeGet((url) => {
      if (url.includes("/games?accessFilter=Public")) return PUBLIC_EMPTY;
      if (url.includes("inventory/9")) return { status: 403, body: { errors: [{ code: 11 }] } };
      return null;
    });
    expect(await listOwnedUniverses(1, get)).toEqual({ universes: [], visibility: "hidden" });
  });

  it("открытый пустой инвентарь — игр у аккаунта нет вовсе (none)", async () => {
    const { get } = fakeGet((url) => {
      if (url.includes("/games?accessFilter=Public")) return PUBLIC_EMPTY;
      if (url.includes("inventory/9")) return { status: 200, body: { data: [] } };
      return null;
    });
    expect((await listOwnedUniverses(1, get)).visibility).toBe("none");
  });

  it("молчание Roblox — не вывод (error), а не «игр нет»", async () => {
    const { get } = fakeGet(() => null);
    expect((await listOwnedUniverses(1, get)).visibility).toBe("error");
  });

  it("плейс есть, но опыт не разрешился — error, а не none", async () => {
    const { get } = fakeGet((url) => {
      if (url.includes("/games?accessFilter=Public")) return PUBLIC_EMPTY;
      if (url.includes("inventory/9")) return { status: 200, body: { data: [{ assetId: 42 }] } };
      return null;
    });
    expect((await listOwnedUniverses(1, get)).visibility).toBe("error");
  });
});

describe("listUniversePasses", () => {
  it("листает страницы и отдаёт живые цены, в том числе снятых с продажи", async () => {
    const { get } = fakeGet((url) => {
      if (url.includes("pageToken=t2")) {
        return { status: 200, body: { gamePasses: [{ id: 2, name: "b", price: null, isForSale: false }] } };
      }
      return {
        status: 200,
        body: {
          gamePasses: [{ id: 1986825093, productId: 3713827743, name: "sharik123", price: 715, isForSale: true, creator: { name: "closed_game_buyer" }, created: "2026-09-20T12:53:57.272Z" }],
          nextPageToken: "t2",
        },
      };
    });
    const passes = await listUniversePasses([{ universeId: "10457317927", placeId: 1, source: "inventory" }], get);
    expect(passes.map((p) => p.id)).toEqual([1986825093, 2]);
    expect(passes[0]).toMatchObject({ price: 715, isForSale: true, creatorName: "closed_game_buyer", universeId: "10457317927" });
    expect(passes[0].createdAt).toBe(Date.parse("2026-09-20T12:53:57.272Z"));
    expect(passes.filter(isSellablePass).map((p) => p.id)).toEqual([1986825093]);
  });
});

describe("parseExperienceRef", () => {
  it("берёт номер опыта из адреса Creator Hub", () => {
    expect(parseExperienceRef("https://create.roblox.com/dashboard/creations/experiences/10457317927/overview"))
      .toEqual({ universeId: "10457317927" });
  });

  it("берёт номер плейса со страницы игры, в том числе с языковым префиксом", () => {
    expect(parseExperienceRef("https://www.roblox.com/games/108336608135295/buyer-Place"))
      .toEqual({ placeId: "108336608135295" });
    expect(parseExperienceRef("https://www.roblox.com/ru/games/108336608135295")).toEqual({ placeId: "108336608135295" });
  });

  it("голое число и мусор не принимает: не понять, опыт это, плейс или пасс", () => {
    expect(parseExperienceRef("10457317927")).toBeNull();
    expect(parseExperienceRef("моя игра")).toBeNull();
  });
});
