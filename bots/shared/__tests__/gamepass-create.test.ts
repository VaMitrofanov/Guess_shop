export {};

/**
 * Движок автосоздания геймпасса (Part 1). Закрепляет проверенный живьём рецепт:
 *   • create — multipart с ASP.NET-полями request.Name/Price/IsForSale;
 *   • IsForSale=true задаётся при создании (без отдельного PATCH);
 *   • два разных 403: "Scope not authorized" = ключ не на том API System
 *     (bad_scope, перебор бессмыслен), иначе чужой опыт → перебор дальше;
 *   • имя — наше, нейтральное (Roblox фильтрует мат), важны цена и «в продаже».
 * Сеть замокана — тесты детерминированы и Roblox не дёргают.
 */

import {
  BRAND_GAMEPASS_NAMES,
  safeGamePassName,
  createGamePassDirect,
  createGamePassForUserDirect,
} from "../roblox";

function mockRes(status: number, jsonObj?: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (jsonObj === undefined ? "" : JSON.stringify(jsonObj)),
  } as unknown as Response;
}

describe("safeGamePassName", () => {
  test("дефолт — брендовое имя RobloxBank (реклама нам)", () => {
    for (let i = 0; i < 20; i++) {
      expect(BRAND_GAMEPASS_NAMES).toContain(safeGamePassName(228));
    }
  });
  test("оставляет валидное латиница/цифры/пробелы имя (ручной override)", () => {
    expect(safeGamePassName(228, "WB 228")).toBe("WB 228");
  });
  test("мат/кириллицу/спецсимволы отбрасывает в брендовое имя (не отдаём Roblox на фильтр)", () => {
    expect(BRAND_GAMEPASS_NAMES).toContain(safeGamePassName(228, "хуйло"));
    expect(BRAND_GAMEPASS_NAMES).toContain(safeGamePassName(228, "!!!"));
    expect(BRAND_GAMEPASS_NAMES).toContain(safeGamePassName(228, "ab")); // слишком коротко
  });
});

describe("createGamePassDirect", () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  test("успех: один POST, multipart-поля, isForSale из ответа", async () => {
    fetchMock.mockResolvedValueOnce(
      mockRes(200, {
        gamePassId: 1968934984,
        name: "Pass 228",
        isForSale: true,
        priceInformation: { defaultPriceInRobux: 228 },
      }),
    );

    const r = await createGamePassDirect("KEY", "10302269431", "Pass 228", 228);

    expect(r.ok).toBe(true);
    expect(r.gamePassId).toBe(1968934984);
    expect(r.isForSale).toBe(true);
    expect(r.priceInRobux).toBe(228);

    // Ровно один запрос (PATCH не нужен, раз isForSale уже true).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/universes/10302269431/game-passes");
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("KEY");
    const form = init.body as FormData;
    expect(form.get("request.Name")).toBe("Pass 228");
    expect(form.get("request.Price")).toBe("228");
    expect(form.get("request.IsForSale")).toBe("true");
  });

  test("403 UnauthorizedAccess → not_authorized (опыт чужой для ключа)", async () => {
    fetchMock.mockResolvedValueOnce(
      mockRes(403, { errorCode: "UnauthorizedAccess", errorMessage: "The user is not authorized to access universe with ID: 999." }),
    );
    const r = await createGamePassDirect("KEY", "999", "Pass 228", 228);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("not_authorized");
    expect(r.universeId).toBe("999");
  });

  test("401 → bad_key (ключ протух или скопирован не целиком)", async () => {
    fetchMock.mockResolvedValueOnce(mockRes(401, { errors: [{ code: 0, message: "Invalid API Key" }] }));
    const r = await createGamePassDirect("KEY", "10302269431", "Pass 228", 228);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("bad_key");
  });

  test("403 Scope not authorized → bad_scope (ключ не на том API System)", async () => {
    fetchMock.mockResolvedValueOnce(mockRes(403, { errors: [{ code: 0, message: "Scope not authorized." }] }));
    const r = await createGamePassDirect("KEY", "10302269431", "Pass 228", 228);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("bad_scope");
  });

  test("создан не в продаже → добивает PATCH'ем", async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockRes(200, { gamePassId: 42, name: "Pass 100", isForSale: false, priceInformation: { defaultPriceInRobux: 100 } }),
      )
      .mockResolvedValueOnce(mockRes(204)); // PATCH IsForSale=true

    const r = await createGamePassDirect("KEY", "1", "Pass 100", 100);
    expect(r.ok).toBe(true);
    expect(r.isForSale).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].method).toBe("PATCH");
  });
});

describe("createGamePassForUserDirect (перебор и валидация)", () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
  });

  test("пустой ключ → ошибка, сеть не трогаем", async () => {
    const r = await createGamePassForUserDirect({ apiKey: "  ", priceInRobux: 228, universeId: "1" });
    expect(r.ok).toBe(false);
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  test("плохая цена → bad_price, сеть не трогаем", async () => {
    const r = await createGamePassForUserDirect({ apiKey: "KEY", priceInRobux: 0, universeId: "1" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("bad_price");
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  test("bad_scope не перебирает кандидатов — новый ключ не появится от другого опыта", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      mockRes(403, { errors: [{ code: 0, message: "Scope not authorized." }] }),
    );
    (global as any).fetch = fetchMock;
    const r = await createGamePassForUserDirect({
      apiKey: "KEY",
      priceInRobux: 228,
      universeId: "1",
      placeId: undefined,
    });
    expect(r.error).toBe("bad_scope");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("явный universeId + успех — создаёт на нём", async () => {
    (global as any).fetch = jest.fn().mockResolvedValueOnce(
      mockRes(200, { gamePassId: 7, name: "Pass 500", isForSale: true, priceInformation: { defaultPriceInRobux: 500 } }),
    );
    const r = await createGamePassForUserDirect({ apiKey: "KEY", priceInRobux: 500, universeId: "10302269431" });
    expect(r.ok).toBe(true);
    expect(r.gamePassId).toBe(7);
    expect(r.universeId).toBe("10302269431");
  });
});
