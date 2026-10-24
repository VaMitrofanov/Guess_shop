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

const wbMarketplaceOrder = { findFirst: jest.fn() };

jest.mock("@prisma/client", () => ({}), { virtual: true });

type OrderThread = typeof import("../order-thread");
let thread: OrderThread;

beforeAll(async () => {
  thread = await import("../order-thread");
});

beforeEach(() => {
  orderEvent.upsert.mockReset().mockResolvedValue({});
  orderEvent.findFirst.mockReset().mockResolvedValue(null);
  wbMarketplaceOrder.findFirst.mockReset().mockResolvedValue(null);
});

const db = { orderEvent, wbMarketplaceOrder } as never;

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

/* ── Один корень на всех отправителей ────────────────────────────────────────
   05.09.2026: про два возможных корня знали только две карточки выкупа.
   Обращение в поддержку, подтверждённый выкуп, скрин оплаты и скрин отзыва
   уходили россыпью, хотя код заказа знали все до одного. `orderThreadRoots`
   отвечает на вопрос «к чему пришивать» один раз и для всех.
   ────────────────────────────────────────────────────────────────────────── */
describe("единый корень ветки заказа", () => {
  it("у DBS-заказа корень — живая карточка", async () => {
    wbMarketplaceOrder.findFirst.mockResolvedValue({
      wbOrderId: "5674129925",
      adminCardMessages: { "85137352": 2902 },
    });
    await expect(thread.orderThreadRoots(db, "NGS22UR")).resolves.toEqual({ "85137352": 2902 });
    // Карточка активации при живой карточке даже не запрашивается.
    expect(orderEvent.findFirst).not.toHaveBeenCalled();
  });

  it("без доставки корнем становится карточка активации кода", async () => {
    orderEvent.findFirst.mockResolvedValue({ payload: { "85137352": 1234 } });
    await expect(thread.orderThreadRoots(db, "9DVCQRM")).resolves.toEqual({ "85137352": 1234 });
  });

  it("DBS-заказ без сохранённой карточки падает на карточку активации", async () => {
    wbMarketplaceOrder.findFirst.mockResolvedValue({ wbOrderId: "5674129925", adminCardMessages: null });
    orderEvent.findFirst.mockResolvedValue({ payload: { "85137352": 1234 } });
    await expect(thread.orderThreadRoots(db, "NGS22UR")).resolves.toEqual({ "85137352": 1234 });
  });

  it("нет кода — нет и запросов в базу", async () => {
    await expect(thread.orderThreadRoots(db, null)).resolves.toBeNull();
    expect(wbMarketplaceOrder.findFirst).not.toHaveBeenCalled();
    expect(orderEvent.findFirst).not.toHaveBeenCalled();
  });

  it("ответ на корень всегда допускает отправку без него: корень могли удалить", () => {
    expect(thread.replyToRoot({ "85137352": 2902 }, "85137352")).toEqual({
      reply_to_message_id: 2902,
      allow_sending_without_reply: true,
    });
    expect(thread.replyToRoot({ "85137352": 2902 }, "7788")).toEqual({});
    expect(thread.replyToRoot(null, "85137352")).toEqual({});
  });
});
