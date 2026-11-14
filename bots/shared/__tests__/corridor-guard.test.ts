import fs from "node:fs";
import path from "node:path";

import { CORRIDOR_OVERRIDE_TTL_MS, corridorHoldText, createCorridorOverride, findUnfinishedCorridorOrder } from "../corridor-guard";

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

describe("память про «всё равно куплю»", () => {
  test("до нажатия согласия нет", () => {
    expect(createCorridorOverride().taken(7)).toBe(false);
  });

  test("после нажатия рельса больше не встаёт — иначе из неё не выйти", () => {
    const override = createCorridorOverride();
    override.allow(7);
    expect(override.taken(7)).toBe(true);
  });

  test("согласие персональное: сосед по чату его не наследует", () => {
    const override = createCorridorOverride();
    override.allow(7);
    expect(override.taken(8)).toBe(false);
  });

  test("число и строка — один и тот же человек: TG даёт id числом, VK строкой", () => {
    const override = createCorridorOverride();
    override.allow(7);
    expect(override.taken("7")).toBe(true);
  });

  test("протухшее согласие возвращает рельсу", () => {
    const override = createCorridorOverride(50);
    override.allow(7);
    const realNow = Date.now;
    Date.now = () => realNow() + 1_000;
    try {
      expect(override.taken(7)).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  test("живёт дольше прохода по паку и заметно короче самого заказа", () => {
    expect(CORRIDOR_OVERRIDE_TTL_MS).toBe(30 * 60 * 1000);
  });
});

describe("рельса стоит и на глубоких callback-ах", () => {
  /**
   * Инлайн-клавиатуры в обоих мессенджерах живут вечно: тап по СТАРОМУ
   * сообщению с паками — законный вход в платную воронку мимо экрана выбора.
   * До 15.09.2026 `dp:`/`direct_pack` гарда не спрашивали вовсе.
   */
  test("TG: выбор пака спрашивает рельсу до создания потока", () => {
    const source = read("bots/tg/handlers.ts");
    const dp = source.slice(source.indexOf('data.startsWith("dp:")'));
    const hold = dp.indexOf("corridorHoldShown");
    const chosen = dp.indexOf("handleDirectPackChosen");
    expect(hold).toBeGreaterThan(-1);
    expect(hold).toBeLessThan(chosen);
  });

  test("VK: выбор пака спрашивает рельсу до создания потока", () => {
    const source = read("bots/vk/handlers.ts");
    const dp = source.slice(source.indexOf('msgPayload?.command === "direct_pack"'));
    const hold = dp.indexOf("corridorHoldShown");
    const chosen = dp.indexOf("handleDirectPackSelect");
    expect(hold).toBeGreaterThan(-1);
    expect(hold).toBeLessThan(chosen);
  });

  test.each(["bots/tg/handlers.ts", "bots/vk/handlers.ts"])("%s: «всё равно» запоминается, а не теряется", (file) => {
    expect(read(file)).toContain("corridorOverride.allow");
  });
});
