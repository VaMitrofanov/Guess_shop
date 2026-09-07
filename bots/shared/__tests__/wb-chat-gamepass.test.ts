import fs from "node:fs";
import path from "node:path";

const mockDetails = jest.fn();
const mockCard = jest.fn();
const mockAttached = jest.fn();
const mockRejected = jest.fn();
const mockAudit = jest.fn();

jest.mock("../roblox", () => ({ getGamepassDetails: (...a: unknown[]) => mockDetails(...a) }));
jest.mock("../admin", () => ({ sendAdminOrderCard: (...a: unknown[]) => mockCard(...a) }));
jest.mock("../wb-delivery-admin-notify", () => ({
  notifyDbsChatGamepassAttached: (...a: unknown[]) => mockAttached(...a),
  notifyDbsChatGamepassRejected: (...a: unknown[]) => mockRejected(...a),
}));
jest.mock("../order-audit", () => ({
  auditGamepassSubmitted: (...a: unknown[]) => mockAudit(...a),
  ORDER_AUDIT_TYPE: {},
}));

import { findGamepassRefInChatText, tryAttachGamepassFromChat, type ChatGamepassDb } from "../wb-chat-gamepass";

/**
 * Геймпасс, присланный покупателем в чат Wildberries.
 *
 * Покупатель шлёт ссылку туда, где с ним уже разговаривали, — в переписку WB.
 * Раньше это никуда не приводило: оператор видел превью текста, заказ висел.
 * Теперь автоматика собирает им заказ, и вот чего ей делать нельзя:
 *   • верить тексту вместо Roblox;
 *   • брать ник из заказа вместо владельца пасса (робуксы уйдут владельцу);
 *   • трогать замороженный или уже собранный заказ;
 *   • шуметь на числах, которые пассом не оказались.
 */

const ref = { wbOrderId: "123", code: "JS6NQB9" };
const order = {
  id: "ord_1", amount: 500, status: "AWAITING_GAMEPASS", platform: "TG",
  orderSource: "WB_DBS", wbCode: "JS6NQB9", robloxUsername: null,
  gamepassUrl: null, userId: "u1", createdAt: new Date(), heldAt: null,
};

/** Мок Prisma: тесту нужны и вызовы модуля, и `.mock` у самих функций. */
const asDb = (mock: ReturnType<typeof makeDb>) => mock as unknown as ChatGamepassDb;

function makeDb(over: Record<string, unknown> = {}) {
  return {
    wbOrder: {
      findFirst: jest.fn().mockResolvedValue(order),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    wbCode: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    orderHold: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue({ username: "buyer", tgId: "5", vkId: null, name: "Юра" }) },
    ...over,
  };
}

beforeEach(() => {
  mockDetails.mockReset().mockResolvedValue({
    id: "1967540063", name: "715", price: 715, creatorId: 1,
    creatorName: "Alumette277", isActive: true,
  });
  mockCard.mockReset().mockResolvedValue(undefined);
  mockAttached.mockReset();
  mockRejected.mockReset();
  mockAudit.mockReset();
});

describe("findGamepassRefInChatText", () => {
  test("ссылка в любом месте сообщения", () => {
    expect(findGamepassRefInChatText("вот держите https://www.roblox.com/game-pass/1967540063/715 спасибо"))
      .toBe("1967540063");
  });

  test("голый ID отдельным словом", () => {
    expect(findGamepassRefInChatText("мой пасс 1967540063")).toBe("1967540063");
  });

  test("телефон пассом не считается", () => {
    expect(findGamepassRefInChatText("мой номер 79991234567")).toBeNull();
  });

  test("два длинных числа — это догадка, а догадка стоит чужого пасса", () => {
    expect(findGamepassRefInChatText("1967540063 или 1967540064")).toBeNull();
  });

  test("код доставки и номинал не длинные числа и не ловятся", () => {
    expect(findGamepassRefInChatText("код 367516, сумма 500")).toBeNull();
  });

  /* Обе проверки ниже — с ЖИВЫХ данных 07.09.2026: прогон разбора по 738
     сообщениям покупателей нашёл 11 совпадений, из которых одно было чужим. */

  test("служебная строка WB «по товару <nmId>» пассом не считается", () => {
    // WB помечает её то `seller`, то `client` — фильтра по отправителю мало.
    expect(findGamepassRefInChatText("Чат с покупателем по товару 967446616")).toBeNull();
  });

  test("номер нашего товара на WB отсекается и по числу", () => {
    expect(findGamepassRefInChatText("вопрос по 967446616", 967446616)).toBeNull();
    expect(findGamepassRefInChatText("вот пасс 1967540063", 967446616)).toBe("1967540063");
  });

  test("адрес Creator Hub читается ссылкой, а не догадкой по длине числа", () => {
    expect(findGamepassRefInChatText(
      "https://create.roblox.com/dashboard/creations/experiences/10342798258/passes/1966753478/configure",
    )).toBe("1966753478");
  });
});

describe("tryAttachGamepassFromChat", () => {
  test("годный пасс собирает заказ, ник берётся у ВЛАДЕЛЬЦА пасса", async () => {
    const db = makeDb();
    const out = await tryAttachGamepassFromChat(asDb(db), { ref, wbCode: "JS6NQB9", text: "https://www.roblox.com/game-pass/1967540063" });

    expect(out).toMatchObject({ kind: "attached", gamepassId: "1967540063", nick: "Alumette277" });
    const data = db.wbOrder.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "PENDING", robloxUsername: "Alumette277", gamepassId: "1967540063" });
    // Защёлка от гонки: пока ходили в Roblox, заказ могли оформить в боте.
    expect(db.wbOrder.updateMany.mock.calls[0][0].where.status).toBe("AWAITING_GAMEPASS");
    expect(mockAttached).toHaveBeenCalled();
    expect(mockCard).toHaveBeenCalledWith(expect.objectContaining({ viaChat: true, creatorName: "Alumette277" }));
  });

  test("увед называет и заказ, и Pass ID — это и просил владелец", async () => {
    await tryAttachGamepassFromChat(asDb(makeDb()), { ref, wbCode: "JS6NQB9", text: "1967540063" });
    expect(mockAttached).toHaveBeenCalledWith(ref, expect.objectContaining({
      wbCode: "JS6NQB9", gamepassId: "1967540063", nick: "Alumette277", price: 715, amount: 500,
    }));
  });

  test("не та цена — не подставляем, зовём оператора", async () => {
    mockDetails.mockResolvedValue({ id: "1", name: "x", price: 500, creatorId: 1, creatorName: "Alumette277", isActive: true });
    const db = makeDb();
    const out = await tryAttachGamepassFromChat(asDb(db), { ref, wbCode: "JS6NQB9", text: "1967540063" });
    expect(out.kind).toBe("rejected");
    expect(db.wbOrder.updateMany).not.toHaveBeenCalled();
    expect(mockRejected).toHaveBeenCalled();
  });

  test("пасс не в продаже — не подставляем", async () => {
    mockDetails.mockResolvedValue({ id: "1", name: "x", price: 715, creatorId: 1, creatorName: "Alumette277", isActive: false });
    const db = makeDb();
    expect((await tryAttachGamepassFromChat(asDb(db), { ref, wbCode: "JS6NQB9", text: "1967540063" })).kind).toBe("rejected");
    expect(db.wbOrder.updateMany).not.toHaveBeenCalled();
  });

  test("чужой владелец при подтверждённом нике — решает человек, не автоматика", async () => {
    const db = makeDb({
      wbOrder: {
        findFirst: jest.fn().mockResolvedValue({ ...order, robloxUsername: "SomeoneElse" }),
        updateMany: jest.fn(),
      },
    });
    const out = await tryAttachGamepassFromChat(asDb(db), { ref, wbCode: "JS6NQB9", text: "1967540063" });
    expect(out).toMatchObject({ kind: "rejected" });
    expect(db.wbOrder.updateMany).not.toHaveBeenCalled();
    expect(String(mockRejected.mock.calls[0][1].reason)).toContain("Alumette277");
  });

  test("Roblox не признал число пассом — ни действия, ни шума", async () => {
    mockDetails.mockResolvedValue(null);
    const db = makeDb();
    expect((await tryAttachGamepassFromChat(asDb(db), { ref, wbCode: "JS6NQB9", text: "1234567890" })).kind).toBe("skipped");
    expect(mockRejected).not.toHaveBeenCalled();
    expect(mockAttached).not.toHaveBeenCalled();
  });

  test("Roblox недоступен — вслепую не принимаем", async () => {
    mockDetails.mockResolvedValue({ id: "1", name: "x", price: 0, creatorId: 0, isActive: false, validationSkipped: true });
    const db = makeDb();
    expect((await tryAttachGamepassFromChat(asDb(db), { ref, wbCode: "JS6NQB9", text: "1967540063" })).kind).toBe("skipped");
    expect(mockRejected).not.toHaveBeenCalled();
  });

  test("замороженный заказ автоматика не трогает", async () => {
    const db = makeDb({
      wbOrder: { findFirst: jest.fn().mockResolvedValue({ ...order, heldAt: new Date() }), updateMany: jest.fn() },
    });
    expect((await tryAttachGamepassFromChat(asDb(db), { ref, wbCode: "JS6NQB9", text: "1967540063" })).kind).toBe("skipped");
    expect(mockDetails).not.toHaveBeenCalled();
  });

  test("заморозка по коду (заказ ещё не помечен) тоже держит", async () => {
    const db = makeDb({ orderHold: { findUnique: jest.fn().mockResolvedValue({ releasedAt: null }) } });
    expect((await tryAttachGamepassFromChat(asDb(db), { ref, wbCode: "JS6NQB9", text: "1967540063" })).kind).toBe("skipped");
    expect(mockDetails).not.toHaveBeenCalled();
  });

  test("уже собранный заказ не пересобираем", async () => {
    const db = makeDb({
      wbOrder: { findFirst: jest.fn().mockResolvedValue({ ...order, status: "PENDING" }), updateMany: jest.fn() },
    });
    expect((await tryAttachGamepassFromChat(asDb(db), { ref, wbCode: "JS6NQB9", text: "1967540063" })).kind).toBe("skipped");
  });

  test("гонка: заказ оформили, пока мы ходили в Roblox — тихо отступаем", async () => {
    const db = makeDb({
      wbOrder: {
        findFirst: jest.fn().mockResolvedValue(order),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        count: jest.fn().mockResolvedValue(0),
      },
    });
    expect((await tryAttachGamepassFromChat(asDb(db), { ref, wbCode: "JS6NQB9", text: "1967540063" })).kind).toBe("skipped");
    expect(mockAttached).not.toHaveBeenCalled();
    expect(mockCard).not.toHaveBeenCalled();
  });
});

describe("воркер зовёт разбор", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "bots/shared/wb-delivery-sync.ts"), "utf8");

  test("только на сообщениях покупателя и только когда в тексте что-то есть", () => {
    expect(source).toContain("findGamepassRefInChatText(rawText, order.nmId)");
    expect(source).toContain("tryAttachGamepassFromChat");
    // Дешёвый разбор стоит ДО похода в базу за карточкой заказа.
    expect(source.indexOf("findGamepassRefInChatText(rawText, order.nmId)"))
      .toBeLessThan(source.indexOf("tryAttachGamepassFromChat(db"));
  });
});
