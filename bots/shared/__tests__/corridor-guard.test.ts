import fs from "node:fs";
import path from "node:path";

import { corridorHoldText, findUnfinishedCorridorOrder } from "../corridor-guard";

/**
 * Пока оплаченный заказ не собран, вторую покупку не начинаем.
 *
 * Правило владельца 07.09.2026: до готовности заказа человека ведут за руку,
 * после — свободное плавание. Кнопка «💎 Купить напрямую» лежит в боте на
 * каждом экране, и для покупателя с висящим оплаченным заказом это ровно та же
 * дверь, в которую он ушёл на сайте (`JS6NQB9` → `WEB-07E4BC427E4A17747E4C`).
 */

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("findUnfinishedCorridorOrder", () => {
  test("спрашивает только про коридор и только про несобранный заказ", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    await findUnfinishedCorridorOrder({ wbOrder: { findFirst } }, "u1");
    const where = findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: "u1", status: "AWAITING_GAMEPASS" });
    expect(where.orderSource.in).toEqual(["WB", "WB_DBS"]);
  });

  test("вероятный ник годится для ссылки: он лучше пустого поля", async () => {
    const findFirst = jest.fn().mockResolvedValue({
      wbCode: "JS6NQB9", amount: 500, robloxUsername: null, probableNick: "Alumette277",
    });
    await expect(findUnfinishedCorridorOrder({ wbOrder: { findFirst } }, "u1")).resolves.toEqual({
      wbCode: "JS6NQB9", amount: 500, nick: "Alumette277",
    });
  });

  test("прямой заказ не держит покупателя: за него он ещё не платил", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    await expect(findUnfinishedCorridorOrder({ wbOrder: { findFirst } }, "u1")).resolves.toBeNull();
  });
});

describe("текст экрана", () => {
  test("это не отказ: называет заказ, сумму и говорит «второй раз платить не нужно»", () => {
    const text = corridorHoldText({ wbCode: "JS6NQB9", amount: 500, nick: null });
    expect(text).toContain("JS6NQB9");
    expect(text).toContain("500 R$");
    expect(text).toContain("второй раз платить не нужно");
  });
});

describe("оба бота держат рельсы", () => {
  test.each(["bots/tg/handlers.ts", "bots/vk/handlers.ts"])("%s: прямая покупка спрашивает про коридор", (file) => {
    const source = read(file);
    expect(source).toContain("findUnfinishedCorridorOrder");
    // Обход обязателен: покупать мы никому не запрещаем.
    expect(source).toMatch(/start_direct_any|startDirectAnyway/);
  });
});
