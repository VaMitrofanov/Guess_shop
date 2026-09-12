import fs from "node:fs";
import path from "node:path";

/**
 * Коридор WB оплачивается ОДИН раз.
 *
 * Разбор 07.09.2026 по `JS6NQB9`. Покупатель оплатил 500 R$ на Wildberries,
 * получил код, завёл заказ в Telegram — и пока тот ждал геймпасс, зашёл в
 * личный кабинет. Ссылка «Подробнее» у активного заказа вела в
 * `/guide?source=site&flow=order`, то есть в ПЛАТНУЮ воронку сайта: через три
 * минуты у него висел второй заказ `WEB-07E4BC427E4A17747E4C` на те же 500 R$,
 * с тем же ником и тем же геймпассом, навсегда застрявший в `PAYMENT_PENDING`.
 *
 * Этот файл держит два правила, которые из случая выросли:
 *   1. У живого заказа ровно ОДИН адрес «продолжить», и для коридора он ведёт
 *      в его собственный гейт с его кодом — никогда в кассу.
 *   2. Пока коридорный заказ не собран, касса его владельцу закрыта.
 */

const mockFindMany = jest.fn();
const mockFindFirst = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    wbOrder: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
  },
}));

import { continueHref, findActiveOrder, findBlockingCorridorOrder, STALE_PAYMENT_MS } from "@/lib/active-order";

const row = (over: Record<string, unknown> = {}) => ({
  id: "ord_1",
  wbCode: "JS6NQB9",
  publicOrderId: null,
  amount: 500,
  status: "AWAITING_GAMEPASS",
  orderSource: "WB_DBS",
  robloxUsername: null,
  createdAt: new Date(),
  ...over,
});

beforeEach(() => {
  mockFindMany.mockReset().mockResolvedValue([]);
  mockFindFirst.mockReset().mockResolvedValue(null);
});

describe("continueHref", () => {
  test("коридорный заказ ведёт в свой гейт, а не в кассу", () => {
    const href = continueHref({ wbCode: "JS6NQB9", orderSource: "WB_DBS", robloxUsername: null });
    expect(href).toBe("/guide?source=wb&skip=1&code=JS6NQB9");
    expect(href).not.toContain("flow=order");
  });

  test("известный ник едет в ссылке — человек не вводит его второй раз", () => {
    expect(continueHref({ wbCode: "JS6NQB9", orderSource: "WB", robloxUsername: "Alumette277" }))
      .toBe("/guide?source=wb&skip=1&code=JS6NQB9&username=Alumette277");
  });

  test("прямой заказ из бота — инструкция без кода", () => {
    expect(continueHref({ wbCode: "DIR-123", orderSource: "DIRECT" })).toBe("/guide?source=direct");
  });

  test("заказ с сайта продолжается в кассе — там его статус оплаты", () => {
    expect(continueHref({ wbCode: "WEB-07E4", orderSource: "SITE", publicOrderId: "WEB-07E4" }))
      .toBe("/payment/status?orderId=WEB-07E4");
  });
});

describe("findActiveOrder", () => {
  test("первым показывается заказ, который ЖДЁТ покупателя", async () => {
    mockFindMany.mockResolvedValue([
      row({ id: "b", status: "IN_PROGRESS", createdAt: new Date(Date.now() - 1000) }),
      row({ id: "a", status: "AWAITING_GAMEPASS", createdAt: new Date(Date.now() - 60_000) }),
    ]);
    const order = await findActiveOrder("user_1");
    expect(order?.id).toBe("a");
    expect(order?.needsGamepass).toBe(true);
  });

  test("брошенная оплата перестаёт быть живым заказом", async () => {
    mockFindMany.mockResolvedValue([
      row({
        id: "stale",
        status: "PAYMENT_PENDING",
        orderSource: "SITE",
        wbCode: "WEB-07E4",
        createdAt: new Date(Date.now() - STALE_PAYMENT_MS - 1000),
      }),
    ]);
    await expect(findActiveOrder("user_1")).resolves.toBeNull();
  });

  test("свежая оплата ещё живая — по ней человек может вернуться в банк", async () => {
    mockFindMany.mockResolvedValue([
      row({ status: "PAYMENT_PENDING", orderSource: "SITE", wbCode: "WEB-07E4", publicOrderId: "WEB-07E4" }),
    ]);
    const order = await findActiveOrder("user_1");
    expect(order?.href).toBe("/payment/status?orderId=WEB-07E4");
    expect(order?.corridor).toBe(false);
  });
});

describe("findBlockingCorridorOrder", () => {
  test("спрашивает только про несобранный заказ коридора", async () => {
    await findBlockingCorridorOrder("user_1");
    const where = mockFindFirst.mock.calls[0][0].where;
    expect(where.status).toBe("AWAITING_GAMEPASS");
    expect(where.orderSource.in).toEqual(["WB", "WB_DBS"]);
  });

  test("нашёлся — у ответа есть адрес, куда вести покупателя", async () => {
    mockFindFirst.mockResolvedValue(row());
    const blocking = await findBlockingCorridorOrder("user_1");
    expect(blocking?.ref).toBe("JS6NQB9");
    expect(blocking?.href).toContain("source=wb&skip=1&code=JS6NQB9");
  });
});

describe("касса", () => {
  const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

  test("оформление заказа спрашивает про коридор ДО создания заказа и платежа", () => {
    const source = read("src/app/api/orders/create/route.ts");
    expect(source).toContain("findBlockingCorridorOrder");
    expect(source).toContain("CORRIDOR_ORDER_ACTIVE");
    // Место вызова (не импорта) — между веткой повторной оплаты и созданием
    // нового заказа: повтор блокировать нельзя (заказ уже заведён, человеку
    // осталось дойти до банка), а новый заказ создавать — нельзя тем более.
    const call = source.indexOf("await findBlockingCorridorOrder(");
    expect(call).toBeGreaterThan(source.indexOf("createPaymentRetry({"));
    expect(call).toBeLessThan(source.indexOf("createCanonicalWebOrder({"));
  });

  test("экран кассы умеет показать этот отказ ссылкой, а не тупиком", () => {
    const source = read("src/app/checkout/page.tsx");
    expect(source).toContain("CORRIDOR_ORDER_ACTIVE");
    expect(source).toContain("corridorOrder");
  });
});
