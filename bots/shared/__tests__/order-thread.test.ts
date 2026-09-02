export {};

/**
 * Нить ОБЫЧНОГО (не-DBS) заказа.
 *
 * 02.09.2026 владелец прислал скриншот по заказу `9DVCQRM`: карточка активации
 * кода («⌛ Ожидаем ссылку на геймпасс», 15:58 МСК) и карточка выкупа («⏳ В
 * обработке» с кнопками, 16:16 МСК) пришли двумя отдельными сообщениями. Обе
 * называют один и тот же код, но выглядят как два разных дела.
 *
 * Нить DBS-заказа собиралась вокруг живой карточки (`adminCardMessages` в
 * `WbMarketplaceOrder`), а у обычного WB-заказа живой карточки нет — поэтому
 * `9DVCQRM` (`orderSource: WB`) в неё не попадал.
 *
 * Здесь проверяется корень для остальных заказов: первая карточка запоминается
 * в `OrderEvent`, вторая уходит ответом на неё.
 */

const orderEvent = {
  upsert: jest.fn(),
  findFirst: jest.fn(),
};

jest.mock("@prisma/client", () => ({}), { virtual: true });

type OrderThread = typeof import("../order-thread");
let thread: OrderThread;

beforeAll(async () => {
  thread = await import("../order-thread");
});

beforeEach(() => {
  orderEvent.upsert.mockReset().mockResolvedValue({});
  orderEvent.findFirst.mockReset().mockResolvedValue(null);
});

const db = { orderEvent } as never;

describe("корень ветки записывается", () => {
  it("кладёт message_id каждого админа под один идемпотентный ключ", async () => {
    await thread.recordOrderCardRoot(db, "order-1", { "85137352": 2902, "7788": 4501 });
    expect(orderEvent.upsert).toHaveBeenCalledTimes(1);
    const arg = orderEvent.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ idempotencyKey: "admin-card-root:order-1" });
    expect(arg.create.payload).toEqual({ "85137352": 2902, "7788": 4501 });
    // Последняя карточка побеждает целиком: корень — то, что сейчас на экране.
    expect(arg.update.payload).toEqual({ "85137352": 2902, "7788": 4501 });
  });

  it("недоставленное сообщение (null) в корень не попадает", async () => {
    await thread.recordOrderCardRoot(db, "order-1", { "85137352": 2902, "7788": null });
    expect(orderEvent.upsert.mock.calls[0][0].create.payload).toEqual({ "85137352": 2902 });
  });

  it("если не доставлено ни одно — записи нет вовсе", async () => {
    await thread.recordOrderCardRoot(db, "order-1", { "85137352": null });
    expect(orderEvent.upsert).not.toHaveBeenCalled();
  });

  // Оформление ветки не имеет права уронить обработку заказа, ради которого
  // карточка и отправлялась.
  it("падение базы не выбрасывает наружу", async () => {
    orderEvent.upsert.mockRejectedValue(Object.assign(new Error("down"), { code: "P1001" }));
    await expect(thread.recordOrderCardRoot(db, "order-1", { "85137352": 1 })).resolves.toBeUndefined();
  });
});

describe("корень ветки читается", () => {
  it("ищется по коду ВБ и отдаёт свежую карточку", async () => {
    orderEvent.findFirst.mockResolvedValue({ payload: { "85137352": 2902 } });
    await expect(thread.orderCardRoots(db, "9DVCQRM")).resolves.toEqual({ "85137352": 2902 });
    const arg = orderEvent.findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ type: "ADMIN_CARD_ROOT", order: { wbCode: "9DVCQRM" } });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
  });

  it("нет корня — null, а не исключение", async () => {
    await expect(thread.orderCardRoots(db, "9DVCQRM")).resolves.toBeNull();
  });

  it("мусор в payload не выдаётся за message_id", async () => {
    orderEvent.findFirst.mockResolvedValue({ payload: { "85137352": "2902", "7788": 0 } });
    await expect(thread.orderCardRoots(db, "9DVCQRM")).resolves.toBeNull();
  });

  it("падение базы не роняет отправку карточки", async () => {
    orderEvent.findFirst.mockRejectedValue(new Error("down"));
    await expect(thread.orderCardRoots(db, "9DVCQRM")).resolves.toBeNull();
  });
});
