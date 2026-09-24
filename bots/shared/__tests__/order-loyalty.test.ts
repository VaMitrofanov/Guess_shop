import { LOYALTY_EXCLUDED_STATUSES, countPreviousOrders } from "../order-loyalty";
import fs from "node:fs";
import path from "node:path";

/**
 * «Повторный клиент» считается одинаково везде.
 *
 * 07.09.2026 карточка выкупа объявила первого в жизни покупателя повторным:
 * у него висел брошенный заказ с сайта в `PAYMENT_PENDING`, по которому денег
 * не приходило никогда. Метка лояльности меняет то, как менеджер читает всю
 * карточку, поэтому ошибаться ей нельзя.
 */

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("countPreviousOrders", () => {
  test("незакрытая корзина и неоплаченная касса заказами не считаются", () => {
    expect([...LOYALTY_EXCLUDED_STATUSES]).toEqual([
      "AWAITING_GAMEPASS",
      "AWAITING_PAYMENT",
      "PAYMENT_PENDING",
    ]);
  });

  test("текущий заказ не считает сам себя — по id", async () => {
    const count = jest.fn().mockResolvedValue(0);
    await countPreviousOrders({ wbOrder: { count } }, { userId: "u1", excludeOrderId: "o1" });
    expect(count).toHaveBeenCalledWith({
      where: {
        userId: "u1",
        status: { notIn: ["AWAITING_GAMEPASS", "AWAITING_PAYMENT", "PAYMENT_PENDING"] },
        id: { not: "o1" },
      },
    });
  });

  test("…и по коду — так спрашивает ВК, где заказа ещё нет", async () => {
    const count = jest.fn().mockResolvedValue(2);
    const prev = await countPreviousOrders({ wbOrder: { count } }, { userId: "u1", excludeWbCode: "JS6NQB9" });
    expect(prev).toBe(2);
    expect(count.mock.calls[0][0].where.wbCode).toEqual({ not: "JS6NQB9" });
  });

  test("падение базы не роняет карточку — «новый клиент» безопаснее пустого экрана", async () => {
    const count = jest.fn().mockRejectedValue(new Error("db down"));
    await expect(countPreviousOrders({ wbOrder: { count } }, { userId: "u1" })).resolves.toBe(0);
  });
});

describe("считают все карточки одним счётом", () => {
  test.each([
    "bots/tg/handlers.ts",
    "bots/vk/handlers.ts",
    "bots/tg/admin/hub-orders.ts",
    "src/app/api/wb-code/select-gamepass/route.ts",
  ])("%s не заводит свой фильтр статусов", (file) => {
    const source = read(file);
    expect(source).toContain("countPreviousOrders");
    expect(source).not.toMatch(/status:\s*\{\s*notIn:\s*\["AWAITING_GAMEPASS"\]\s*\}/);
  });
});
