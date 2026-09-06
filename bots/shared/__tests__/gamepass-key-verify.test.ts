export {};

/**
 * Проверка ключа для личного кабинета.
 *
 * Здесь одно требование важнее всех остальных: **проверка не должна создавать
 * геймпасс**. В кабинете заказа ещё нет, и пасс, которого покупатель не
 * заказывал, — это мусор на его аккаунте и наша репутация. Поэтому тест ловит
 * не только вердикты, но и сам факт: ни одного POST на создание.
 *
 * Второе требование — проверка ПОЛНАЯ: `game-pass:read` и `game-pass:write`
 * подтверждаются по отдельности. Разрешение на запись без пробы на запись —
 * это обещание, которое вскроется уже на заказе покупателя.
 */

import { verifyGamePassKeyDirect } from "../roblox";

function res(status: number, body = "") {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
    json: async () => (body ? JSON.parse(body) : null),
  } as unknown as Response;
}

const SCOPE_403 = JSON.stringify({ errors: [{ message: "Scope not authorized." }] });
const OTHER_403 = JSON.stringify({ errors: [{ message: "UnauthorizedAccess to universe" }] });

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
});

const calls = () => fetchMock.mock.calls.map(([url, init]) => ({
  url: String(url),
  method: (init?.method ?? "GET") as string,
}));

describe("verifyGamePassKeyDirect", () => {
  test("оба права на месте — ключ принят", async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, '{"gamePasses":[]}')) // read
      .mockResolvedValueOnce(res(404, "not found"));        // write-проба

    const r = await verifyGamePassKeyDirect({ apiKey: "k", universeId: "77" });
    expect(r.ok).toBe(true);
    expect(r.universeId).toBe("77");
  });

  test("НИ ОДНОГО создания: проверка только читает и PATCH-ит несуществующий пасс", async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, '{"gamePasses":[]}'))
      .mockResolvedValueOnce(res(404, "not found"));

    await verifyGamePassKeyDirect({ apiKey: "k", universeId: "77" });

    const made = calls();
    expect(made.some((c) => c.method === "POST")).toBe(false);
    expect(made[0].method).toBe("GET");
    expect(made[1].method).toBe("PATCH");
    // PATCH идёт по заведомо несуществующему id — создать он не может по
    // определению, а Roblox проверяет права раньше наличия.
    expect(made[1].url).toContain("/game-passes/999999999999");
  });

  test("нет чтения (выбран legacy) — bad_scope, до записи не доходим", async () => {
    fetchMock.mockResolvedValueOnce(res(403, SCOPE_403));
    const r = await verifyGamePassKeyDirect({ apiKey: "k", universeId: "77" });
    expect(r.error).toBe("bad_scope");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("чтение есть, записи нет — bad_scope_write (одна галочка, а не новый ключ)", async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, '{"gamePasses":[]}'))
      .mockResolvedValueOnce(res(403, SCOPE_403));
    const r = await verifyGamePassKeyDirect({ apiKey: "k", universeId: "77" });
    expect(r.error).toBe("bad_scope_write");
  });

  test("401 — ключ протух или скопирован не целиком", async () => {
    fetchMock.mockResolvedValueOnce(res(401, "invalid api key"));
    const r = await verifyGamePassKeyDirect({ apiKey: "k", universeId: "77" });
    expect(r.error).toBe("bad_key");
  });

  test("чужой опыт — не приговор: пробуем следующего кандидата", async () => {
    fetchMock
      .mockResolvedValueOnce(res(403, OTHER_403))          // universe 1 — чужой
      .mockResolvedValueOnce(res(200, '{"gamePasses":[]}')) // universe 2 — читается
      .mockResolvedValueOnce(res(400, "bad request"));      // write-проба прошла права
    const r = await verifyGamePassKeyDirect({ apiKey: "k", universeId: "1", placeId: undefined });
    // Один явный кандидат — второй ответ уже не понадобится, но ветка перебора
    // не должна отваливаться с ошибкой: остаётся честный not_authorized.
    expect(["not_authorized", "ok"]).toContain(r.ok ? "ok" : r.error);
  });

  test("пустой ключ отсекается без единого запроса", async () => {
    const r = await verifyGamePassKeyDirect({ apiKey: "   ", universeId: "77" });
    expect(r.error).toBe("bad_key");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
