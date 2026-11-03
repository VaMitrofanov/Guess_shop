/**
 * Выбор опыта для создания пасса по ключу: честные причины отказа и повтор
 * создания с латинским именем.
 *
 * До 21.09.2026 любая неудача резолва — закрытая игра, кривой ник, молчание
 * Roblox — звучала одинаково: «не нашли твою игру». За пять дней это 41 отказ
 * из 45, хотя у многих игра была.
 */

export {};

const json = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
  }) as unknown as Response;

type World = {
  userExists?: boolean;
  inventory: "hidden" | "empty" | { placeId: number; universeId: number };
};

function mockWorld(world: World, create?: (url: string, init?: RequestInit) => Response) {
  return jest.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("usernames/users")) {
      return json({ data: world.userExists === false ? [] : [{ id: 42, name: "hidden_inv_buyer" }] });
    }
    if (url.includes("/games?accessFilter=Public")) return json({ data: [], nextPageCursor: null });
    if (url.includes("inventory/9")) {
      if (world.inventory === "hidden") return json({ errors: [{ code: 11 }] }, 403);
      if (world.inventory === "empty") return json({ data: [] });
      return json({ data: [{ assetId: world.inventory.placeId }] });
    }
    if (url.includes("/universes/v1/places/") && typeof world.inventory === "object") {
      return json({ universeId: world.inventory.universeId });
    }
    if (create && init?.method === "POST" && url.includes("/game-passes")) return create(url, init);
    if (url.includes("/game-passes?passView=Full")) return json({ gamePasses: [] });
    return json({}, 404);
  });
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  jest.resetModules();
});

async function load() {
  return import("../roblox");
}

describe("resolveUniverseCandidatesDirect", () => {
  it("закрытый инвентарь без публичных игр — games_hidden, а не «игры нет»", async () => {
    global.fetch = mockWorld({ inventory: "hidden" }) as unknown as typeof fetch;
    const { resolveUniverseCandidatesDirect } = await load();
    expect(await resolveUniverseCandidatesDirect({ username: "hidden_inv_buyer" })).toEqual({ candidates: [], failure: "games_hidden" });
  });

  it("нет такого ника — nick_not_found", async () => {
    global.fetch = mockWorld({ userExists: false, inventory: "empty" }) as unknown as typeof fetch;
    const { resolveUniverseCandidatesDirect } = await load();
    expect((await resolveUniverseCandidatesDirect({ username: "nope_nope" })).failure).toBe("nick_not_found");
  });

  it("плейсов нет вовсе — no_universe", async () => {
    global.fetch = mockWorld({ inventory: "empty" }) as unknown as typeof fetch;
    const { resolveUniverseCandidatesDirect } = await load();
    expect((await resolveUniverseCandidatesDirect({ username: "hidden_inv_buyer" })).failure).toBe("no_universe");
  });

  it("закрытая игра из инвентаря становится кандидатом", async () => {
    global.fetch = mockWorld({ inventory: { placeId: 108336608135295, universeId: 10457317927 } }) as unknown as typeof fetch;
    const { resolveUniverseCandidatesDirect } = await load();
    expect(await resolveUniverseCandidatesDirect({ username: "closed_game_buyer" })).toEqual({ candidates: ["10457317927"] });
  });

  it("явная ссылка на игру снимает вопрос видимости", async () => {
    global.fetch = mockWorld({ inventory: "hidden" }) as unknown as typeof fetch;
    const { resolveUniverseCandidatesDirect } = await load();
    expect(await resolveUniverseCandidatesDirect({ username: "hidden_inv_buyer", universeId: "10457317927" }))
      .toEqual({ candidates: ["10457317927"] });
  });
});

describe("createGamePassForUserDirect", () => {
  it("отдаёт покупателю games_hidden вместо «не нашли твою игру»", async () => {
    global.fetch = mockWorld({ inventory: "hidden" }) as unknown as typeof fetch;
    const { createGamePassForUserDirect } = await load();
    const res = await createGamePassForUserDirect({ apiKey: "k".repeat(40), priceInRobux: 715, username: "hidden_inv_buyer" });
    expect(res).toMatchObject({ ok: false, error: "games_hidden" });
  });
});

describe("createGamePassDirect — повтор на 5xx", () => {
  it("на 500 с кириллическим именем повторяет с латинским и создаёт пасс", async () => {
    const names: string[] = [];
    let attempt = 0;
    global.fetch = mockWorld({ inventory: "empty" }, (_url, init) => {
      names.push(String((init?.body as FormData).get("request.Name")));
      attempt += 1;
      return attempt === 1
        ? json({ code: "INTERNAL", message: "InternalError" }, 500)
        : json({ gamePassId: 1990000001, isForSale: true, name: "RobloxBank", priceInformation: { defaultPriceInRobux: 715 } });
    }) as unknown as typeof fetch;
    const { createGamePassDirect, LATIN_GAMEPASS_NAME } = await load();
    const res = await createGamePassDirect("k".repeat(40), "10457317927", "С любовью от RobloxBank", 715);
    expect(res).toMatchObject({ ok: true, gamePassId: 1990000001 });
    expect(names).toEqual(["С любовью от RobloxBank", LATIN_GAMEPASS_NAME]);
  });

  it("не создаёт второй пасс, если первый всё-таки появился", async () => {
    let posts = 0;
    const world = mockWorld({ inventory: "empty" }, () => {
      posts += 1;
      return json({ message: "InternalError" }, 500);
    });
    global.fetch = jest.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (!init?.method && url.includes("/game-passes?passView=Full")) {
        return json({ gamePasses: [{ id: 1990000002, name: "RobloxBank топ", price: 715, isForSale: true, created: new Date().toISOString() }] });
      }
      return world(input, init);
    }) as unknown as typeof fetch;
    const { createGamePassDirect } = await load();
    const res = await createGamePassDirect("k".repeat(40), "10457317927", "RobloxBank топ", 715);
    expect(res).toMatchObject({ ok: true, gamePassId: 1990000002 });
    expect(posts).toBe(1);
  });

  it("4xx не повторяет: это не сбой Roblox, а ответ по существу", async () => {
    let posts = 0;
    global.fetch = mockWorld({ inventory: "empty" }, () => {
      posts += 1;
      return json({ message: "bad request" }, 400);
    }) as unknown as typeof fetch;
    const { createGamePassDirect } = await load();
    const res = await createGamePassDirect("k".repeat(40), "10457317927", "RobloxBank топ", 715);
    expect(res).toMatchObject({ ok: false, error: "roblox_error", httpStatus: 400 });
    expect(posts).toBe(1);
  });
});
