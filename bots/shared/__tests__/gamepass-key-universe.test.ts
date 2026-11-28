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

/** Ключ той же формы, что выдаёт Roblox: 48 символов секрета + base64 от JWT с ownerId. */
function fakeKey(ownerId: string): string {
  const jwt = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ ownerId, aud: "RobloxInternal" })).toString("base64url")}.sig`;
  return "A".repeat(48) + Buffer.from(jwt).toString("base64");
}

/** Закрытый инвентарь по нику, а ключ видит плейсы владельца (или нет). */
function keyWorld(byKey: "places" | "none" | "no_scope") {
  const base = mockWorld({ inventory: "hidden" });
  return jest.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/inventory-items")) {
      if (byKey === "no_scope") return json({ code: "PERMISSION_DENIED" }, 403);
      return json({
        inventoryItems: byKey === "places"
          ? [{ assetDetails: { assetId: "777", inventoryItemAssetType: "CREATED_PLACE" } }]
          : [],
        nextPageToken: "",
      });
    }
    if (url.includes("/universes/v1/places/777/universe")) return json({ universeId: 5715080564 });
    return base(input, init);
  });
}

describe("ключ сам находит игру и сверяет владельца (13.11.2026)", () => {
  it("владелец читается из строки ключа", async () => {
    const { apiKeyOwnerId } = await load();
    expect(apiKeyOwnerId(fakeKey("3828548511"))).toBe("3828548511");
    expect(apiKeyOwnerId("k".repeat(40))).toBeNull();
  });

  it("закрытый инвентарь, но у ключа есть право на список игр — игра найдена", async () => {
    global.fetch = keyWorld("places") as unknown as typeof fetch;
    const { resolveUniverseCandidatesDirect } = await load();
    expect(await resolveUniverseCandidatesDirect({ username: "hidden_inv_buyer", apiKey: fakeKey("42") }))
      .toEqual({ candidates: ["5715080564"] });
  });

  it("ключ видит инвентарь, а плейсов нет — no_universe наверняка", async () => {
    global.fetch = keyWorld("none") as unknown as typeof fetch;
    const { resolveUniverseCandidatesDirect } = await load();
    expect((await resolveUniverseCandidatesDirect({ username: "hidden_inv_buyer", apiKey: fakeKey("42") })).failure).toBe("no_universe");
  });

  it("у ключа нет права на список игр — по-старому games_hidden", async () => {
    global.fetch = keyWorld("no_scope") as unknown as typeof fetch;
    const { resolveUniverseCandidatesDirect } = await load();
    expect((await resolveUniverseCandidatesDirect({ username: "hidden_inv_buyer", apiKey: fakeKey("42") })).failure).toBe("games_hidden");
  });

  it("ключ от другого аккаунта — key_other_account, пасс не создаётся", async () => {
    let posts = 0;
    global.fetch = mockWorld({ inventory: { placeId: 1, universeId: 2 } }, () => { posts += 1; return json({}); }) as unknown as typeof fetch;
    const { createGamePassForUserDirect } = await load();
    const res = await createGamePassForUserDirect({ apiKey: fakeKey("999"), priceInRobux: 715, username: "hidden_inv_buyer" });
    expect(res).toMatchObject({ ok: false, error: "key_other_account" });
    expect(posts).toBe(0);
  });

  it("ник не нужен: игра ищется по владельцу ключа", async () => {
    global.fetch = keyWorld("places") as unknown as typeof fetch;
    const { resolveUniverseCandidatesDirect } = await load();
    expect(await resolveUniverseCandidatesDirect({ apiKey: fakeKey("42") })).toEqual({ candidates: ["5715080564"] });
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
