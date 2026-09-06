import { NextRequest } from "next/server";

/**
 * Метод «пасс по ключу» (инструкция V2): роут и вердикты покупателю.
 *
 * Закрепляем главное, что нельзя сломать молча:
 *   • ключ НЕ возвращается наружу и не попадает в ответ;
 *   • выключенный флаг = метода нет (404), а не «тихо ничего не делает»;
 *   • при отказе на втором пассе первый не теряется — заказ соберётся наполовину;
 *   • тексты вердиктов ведут человека к действию, а не показывают код ошибки.
 */

const mockCreate = jest.fn();
const mockFlag = jest.fn();
const mockRemember = jest.fn();
const mockAudit = jest.fn();
const mockOrderFind = jest.fn();
const mockOrderUpdate = jest.fn();

jest.mock("@/lib/roblox-gamepass-create", () => ({
  createGamePassViaBridge: (...args: unknown[]) => mockCreate(...args),
}));
jest.mock("@/lib/gamepass-autocreate-flag", () => ({
  gamepassAutocreateEnabled: () => mockFlag(),
}));
jest.mock("@/lib/roblox-api-key-store", () => ({
  rememberRobloxApiKey: (...args: unknown[]) => mockRemember(...args),
}));
jest.mock("@/lib/order-audit", () => ({
  auditGamepassAutocreated: (...args: unknown[]) => mockAudit(...args),
}));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    wbOrder: {
      findFirst: (...args: unknown[]) => mockOrderFind(...args),
      update: (...args: unknown[]) => mockOrderUpdate(...args),
    },
  },
}));

import { POST } from "@/app/api/roblox/gamepass-create/route";
import { keyCreateVerdict, keyCreateSuccessText } from "@/lib/gamepass-create-messages";
import { planFromOwned, targetsToCreate } from "@/lib/gamepass-plan";

const KEY = "Oc567XuPVUmyo8yc0PP27WLic2c3NZcAhUStwG1vt9m8+PhA";

function req(body: unknown, ip = "10.0.0.1") {
  return new NextRequest("https://robloxbank.ru/api/roblox/gamepass-create", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("POST /api/roblox/gamepass-create", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockFlag.mockReset();
    mockRemember.mockReset();
    mockAudit.mockReset();
    mockOrderFind.mockReset();
    mockOrderUpdate.mockReset();
    mockFlag.mockReturnValue(true);
    mockRemember.mockResolvedValue("saved");
    mockAudit.mockResolvedValue(undefined);
    mockOrderFind.mockResolvedValue(null);
    mockOrderUpdate.mockResolvedValue({});
  });

  test("флаг выключен → метода нет (404), мост не дёргаем", async () => {
    mockFlag.mockReturnValue(false);
    const res = await POST(req({ key: KEY, nick: "mono262910", targets: [143] }, "10.0.1.1"));
    expect(res.status).toBe(404);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("пустой ключ → bad_key, без похода на мост", async () => {
    const res = await POST(req({ key: "   ", nick: "mono262910", targets: [143] }, "10.0.1.2"));
    expect(await res.json()).toEqual({ ok: false, error: "bad_key" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("цена вне диапазона → bad_price", async () => {
    const res = await POST(req({ key: KEY, nick: "mono262910", targets: [0, -5] }, "10.0.1.3"));
    expect(await res.json()).toEqual({ ok: false, error: "bad_price" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("нет ника → no_universe (мосту не на чем резолвить опыт)", async () => {
    const res = await POST(req({ key: KEY, nick: "", targets: [143] }, "10.0.1.4"));
    expect(await res.json()).toEqual({ ok: false, error: "no_universe" });
  });

  test("успех: пасс на каждую цену, ключ уходит мосту и не возвращается", async () => {
    mockCreate
      .mockResolvedValueOnce({ ok: true, gamePassId: 1968385534, priceInRobux: 1429, name: "RobloxBank" })
      .mockResolvedValueOnce({ ok: true, gamePassId: 1970321037, priceInRobux: 1429, name: "RobloxBank" });

    const res = await POST(req({ key: KEY, nick: "mono262910", targets: [1429, 1429] }, "10.0.1.5"));
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.created).toHaveLength(2);
    expect(data.created[0]).toMatchObject({ gamePassId: 1968385534, priceInRobux: 1429 });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenCalledWith({ apiKey: KEY, priceInRobux: 1429, username: "mono262910" });
    // Ключ — креденшл клиента: наружу он не уходит ни в каком виде.
    expect(JSON.stringify(data)).not.toContain(KEY);
  });

  test("отказ на втором пассе → первый отдаём, чтобы заказ собрался наполовину", async () => {
    mockCreate
      .mockResolvedValueOnce({ ok: true, gamePassId: 111, priceInRobux: 1000 })
      .mockResolvedValueOnce({ ok: false, error: "bad_scope", detail: "нужен API System game-passes" });

    const res = await POST(req({ key: KEY, nick: "mono262910", targets: [1000, 1000] }, "10.0.1.6"));
    const data = await res.json();

    expect(data.ok).toBe(false);
    expect(data.error).toBe("bad_scope");
    expect(data.created).toHaveLength(1);
  });

  test("больше двух пассов на заказ не создаём", async () => {
    mockCreate.mockResolvedValue({ ok: true, gamePassId: 1, priceInRobux: 100 });
    await POST(req({ key: KEY, nick: "mono262910", targets: [100, 100, 100, 100] }, "10.0.1.7"));
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test("частим → 429 и мост не трогаем", async () => {
    mockCreate.mockResolvedValue({ ok: true, gamePassId: 1, priceInRobux: 100 });
    const ip = "10.0.2.99";
    for (let i = 0; i < 5; i++) await POST(req({ key: KEY, nick: "n", targets: [100] }, ip));
    const calls = mockCreate.mock.calls.length;
    const res = await POST(req({ key: KEY, nick: "n", targets: [100] }, ip));
    expect(res.status).toBe(429);
    expect(mockCreate.mock.calls.length).toBe(calls);
  });
});

describe("вердикты покупателю", () => {
  test("bad_scope ведёт обратно в список, называя оба нужных права", () => {
    const v = keyCreateVerdict("bad_scope");
    expect(v.text).toContain("game-passes");
    expect(v.text).toContain("read");
    expect(v.text).toContain("write");
    expect(v.retry).toBe(false);
  });

  test("bad_key объясняет час жизни ключа", () => {
    expect(keyCreateVerdict("bad_key").text).toContain("час");
  });

  test("неизвестный код — не показываем код, зовём в бот", () => {
    const v = keyCreateVerdict("что-то_новое");
    expect(v.text).not.toContain("что-то_новое");
    expect(v.text).toContain("бот");
  });

  test("ни один вердикт не говорит «скоуп» и не сыплет кодами", () => {
    for (const code of ["bad_key", "bad_scope", "not_authorized", "no_universe", "network", "rate_limited"]) {
      const v = keyCreateVerdict(code);
      expect(v.text.toLowerCase()).not.toContain("скоуп");
      expect(v.text).not.toContain(code);
      expect(v.title.length).toBeLessThan(40);
    }
  });

  test("успех называет цены созданных пассов", () => {
    expect(keyCreateSuccessText([143])).toContain("143");
    expect(keyCreateSuccessText([1000, 1000])).toContain("два пасса");
  });
});

/**
 * След созданного пасса. Владелец просил, чтобы после ключа заказ был не просто
 * оформлен, а РАЗМЕЧЕН: админ должен видеть, что цену и «в продаже» выставляли
 * мы, а не покупатель. Держим три следа сразу — событие, заметку и ключ.
 */
describe("след автосоздания", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockFlag.mockReset();
    mockRemember.mockReset();
    mockAudit.mockReset();
    mockOrderFind.mockReset();
    mockOrderUpdate.mockReset();
    mockFlag.mockReturnValue(true);
    mockRemember.mockResolvedValue("saved");
    mockAudit.mockResolvedValue(undefined);
    mockOrderUpdate.mockResolvedValue({});
    mockOrderFind.mockResolvedValue({ id: "ord_1", userId: "usr_1", adminNote: null });
  });

  test("по коду WB: событие на каждый пасс, строка в заметке, ключ сохранён", async () => {
    mockCreate
      .mockResolvedValueOnce({ ok: true, gamePassId: 111, priceInRobux: 2143, universeId: "3870886947" })
      .mockResolvedValueOnce({ ok: true, gamePassId: 222, priceInRobux: 715, universeId: "3870886947" });

    const res = await POST(req({ key: KEY, nick: "mono262910", code: "84CR7UZ", targets: [2143, 715] }, "10.0.9.1"));
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Ключ не возвращается наружу ни при каком исходе.
    expect(JSON.stringify(body)).not.toContain(KEY);

    // Событие — на каждый созданный пасс, с ценой и опытом.
    expect(mockAudit).toHaveBeenCalledTimes(2);
    expect(mockAudit.mock.calls[0][1]).toMatchObject({ gamepassId: "111", price: 2143, orderId: "ord_1" });
    expect(mockAudit.mock.calls[1][1]).toMatchObject({ gamepassId: "222", price: 715 });

    // Заметка заказа — то, что видно в карточке TWA и веб-админки без раскрытия ленты.
    const note = mockOrderUpdate.mock.calls[0][0].data.adminNote as string;
    expect(note).toContain("API-ключу");
    expect(note).toContain("111 · 2143 R$");
    expect(note).toContain("222 · 715 R$");

    // Ключ сохранён с привязкой к заказу и владельцу — но НИКОГДА не возвращается.
    expect(mockRemember).toHaveBeenCalledWith(
      expect.objectContaining({ key: KEY, robloxUsername: "mono262910", orderId: "ord_1", userId: "usr_1", result: "ok", createdPasses: 2 }),
    );
  });

  test("без кода WB (покупка на сайте): ключ помним, заказ не трогаем", async () => {
    mockCreate.mockResolvedValue({ ok: true, gamePassId: 333, priceInRobux: 1429 });
    const res = await POST(req({ key: KEY, nick: "mono262910", targets: [1429] }, "10.0.9.2"));
    expect((await res.json()).ok).toBe(true);
    expect(mockRemember).toHaveBeenCalledTimes(1);
    expect(mockAudit).not.toHaveBeenCalled();
    expect(mockOrderUpdate).not.toHaveBeenCalled();
  });

  test("отказ до первого пасса: ключ не сохраняем и заказ не размечаем", async () => {
    mockCreate.mockResolvedValue({ ok: false, error: "bad_scope" });
    const res = await POST(req({ key: KEY, nick: "mono262910", code: "84CR7UZ", targets: [1429] }, "10.0.9.3"));
    expect(await res.json()).toEqual({ ok: false, error: "bad_scope", created: [] });
    expect(mockRemember).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  test("создался первый из двух: ключ помним как partial, событие только на созданный", async () => {
    mockCreate
      .mockResolvedValueOnce({ ok: true, gamePassId: 444, priceInRobux: 2143 })
      .mockResolvedValueOnce({ ok: false, error: "network" });
    const res = await POST(req({ key: KEY, nick: "mono262910", code: "84CR7UZ", targets: [2143, 715] }, "10.0.9.4"));
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, error: "network" });
    expect(body.created).toHaveLength(1);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockRemember).toHaveBeenCalledWith(expect.objectContaining({ result: "partial", createdPasses: 1 }));
  });
});

/**
 * Требование владельца: заказ на 2000 по ключу должен получить ДВА пасса —
 * 2143 (1500 на руки) и 715 (500). Тест держит всю цепочку: разбор плана →
 * цены, которые уходят на мост → что увидит админ в разбивке.
 */
describe("номинал 2000 по ключу", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockFlag.mockReset().mockReturnValue(true);
    mockRemember.mockReset().mockResolvedValue("saved");
    mockAudit.mockReset().mockResolvedValue(undefined);
    mockOrderFind.mockReset().mockResolvedValue({ id: "ord_2000", userId: "usr_1", adminNote: null });
    mockOrderUpdate.mockReset().mockResolvedValue({});
  });

  test("пустой аккаунт → на мост уходят ровно 2143 и 715", async () => {
    const prices = targetsToCreate(planFromOwned(2000, [])).map((t) => t.price);
    expect(prices).toEqual([2143, 715]);

    mockCreate
      .mockResolvedValueOnce({ ok: true, gamePassId: 1963665231, priceInRobux: 2143 })
      .mockResolvedValueOnce({ ok: true, gamePassId: 1970321037, priceInRobux: 715 });

    const res = await POST(req({ key: KEY, nick: "mono262910", code: "84CR7UZ", targets: prices }, "10.0.20.1"));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(mockCreate.mock.calls.map((c) => (c[0] as { priceInRobux: number }).priceInRobux)).toEqual([2143, 715]);
    expect(body.created.map((p: { gamePassId: number }) => p.gamePassId)).toEqual([1963665231, 1970321037]);
    // Заметка админа несёт оба ID с их ценами — это то, что он увидит в карточке.
    expect(mockOrderUpdate.mock.calls[0][0].data.adminNote).toContain("1963665231 · 2143 R$");
    expect(mockOrderUpdate.mock.calls[0][0].data.adminNote).toContain("1970321037 · 715 R$");
  });
});
