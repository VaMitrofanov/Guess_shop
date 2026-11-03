import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { basketItemHref, basketItemState, basketLabel, buildBasket, nextBasketItem, type BasketRow } from "@/lib/wb-basket";

const row = (over: Partial<BasketRow>): BasketRow => ({
  wbOrderId: "6172791748", amount: 500, cancelled: false, code: null, orderStatus: null, nick: null, gamepassId: null, ...over,
});

describe("корзина WB — что видит покупатель (01.11.2026)", () => {
  it("состояние заказа корзины", () => {
    expect(basketItemState(row({ cancelled: true, code: "AAA1111" }))).toBe("cancelled");
    expect(basketItemState(row({}))).toBe("waiting");
    expect(basketItemState(row({ code: "F4B6GVN" }))).toBe("todo");
    expect(basketItemState(row({ code: "F4B6GVN", orderStatus: "AWAITING_GAMEPASS" }))).toBe("todo");
    expect(basketItemState(row({ code: "DGG7S3N", orderStatus: "PENDING", nick: "lynukawe" }))).toBe("done");
  });

  it("одиночный заказ — пусто; порядок как у WB; код соседа — только неоформленного", () => {
    expect(buildBasket([row({ code: "DGG7S3N" })], "DGG7S3N")).toEqual([]);
    const items = buildBasket([
      row({ wbOrderId: "6172791756", code: "RPJ4D98", orderStatus: "PENDING", nick: "lynukawe" }),
      row({ wbOrderId: "6172791748", code: "DGG7S3N", orderStatus: "PENDING", nick: "lynukawe" }),
      row({ wbOrderId: "6172791755", code: "F4B6GVN" }),
    ], "DGG7S3N");
    expect(items.map((i) => [i.index, i.state, i.self, i.code])).toEqual([
      [1, "done", true, null],
      [2, "todo", false, "F4B6GVN"],
      [3, "done", false, null],
    ]);
    expect(nextBasketItem(items)?.code).toBe("F4B6GVN");
  });

  it("«на этот же» подставляет ник, «на другой» — нет", () => {
    const item = { index: 2, total: 2, amount: 500, state: "todo" as const, code: "F4B6GVN", nick: null, self: false };
    expect(basketItemHref(item, "lynukawe")).toBe("/guide?source=wb&skip=1&code=F4B6GVN&username=lynukawe");
    expect(basketItemHref(item, null)).toBe("/guide?source=wb&skip=1&code=F4B6GVN");
  });

  it("метка в админке: позиция и «2 аккаунта» только при разных никах", () => {
    expect(basketLabel(null, [])).toBeNull();
    expect(basketLabel({ index: 1, total: 1 }, [])).toBeNull();
    expect(basketLabel({ index: 1, total: 2 }, ["Kill", "kill"])).toEqual({ text: "🧺 1/2", twoAccounts: false });
    expect(basketLabel({ index: 2, total: 2 }, ["a1", "b2"])).toEqual({ text: "🧺 2/2", twoAccounts: true });
  });

  it("API корзины отдаёт соседей только тому, кто уже оформил свой заказ", () => {
    const route = readFileSync(resolve(__dirname, "../app/api/wb-code/basket/route.ts"), "utf8");
    expect(route).toContain("rateLimit(");
    expect(route).toMatch(/if \(!own\) return NextResponse\.json\(\{ items: \[\] \}\);/);
  });
});
