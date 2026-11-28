import { canOrderAction, ORDER_ACTIONS } from "../lib/order-actions";

describe("order-actions — один реестр на TWA, сайт и сервер", () => {
  it("ошибкой метят только то, что выкупается (сервер set-error)", () => {
    expect(canOrderAction({ status: "PENDING" }, "error")).toBe(true);
    expect(canOrderAction({ status: "IN_PROGRESS" }, "error")).toBe(true);
    // TWA раньше предлагала это ждущему пасс — сервер отвечал 400.
    expect(canOrderAction({ status: "AWAITING_GAMEPASS" }, "error")).toBe(false);
    expect(canOrderAction({ status: "ERROR" }, "error")).toBe(false);
    expect(canOrderAction({ status: "PENDING", heldAt: new Date() }, "error")).toBe(false);
  });

  it("замороженный не правится (сервер edit-order отвечает 409)", () => {
    expect(canOrderAction({ status: "PENDING" }, "edit")).toBe(true);
    expect(canOrderAction({ status: "COMPLETED" }, "edit")).toBe(true);
    expect(canOrderAction({ status: "PENDING", heldAt: "2026-11-25" }, "edit")).toBe(false);
    expect(canOrderAction({ status: "IN_PROGRESS" }, "edit")).toBe(false);
  });

  it("отмена, перепривязка, очередь, заморозка", () => {
    expect(canOrderAction({ status: "COMPLETED" }, "reject")).toBe(false);
    expect(canOrderAction({ status: "AWAITING_PAYMENT" }, "reject")).toBe(true);
    expect(canOrderAction({ status: "REJECTED" }, "rebind")).toBe(true);
    expect(canOrderAction({ status: "COMPLETED" }, "rebind")).toBe(false);
    expect(canOrderAction({ status: "COMPLETED" }, "priority")).toBe(false);
    expect(canOrderAction({ status: "REJECTED" }, "hold")).toBe(false);
    expect(canOrderAction({ status: "PENDING", heldAt: new Date() }, "unhold")).toBe(true);
    expect(canOrderAction({ status: "COMPLETED" }, "resend")).toBe(true);
  });

  it("у каждого действия есть имя и значок", () => {
    for (const meta of Object.values(ORDER_ACTIONS)) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.icon.length).toBeGreaterThan(0);
    }
  });
});

import { orderPlaceOf, placeRequests } from "../lib/order-actions";

describe("«Где заказ» — переносы из существующих действий", () => {
  it("место по статусу", () => {
    expect(orderPlaceOf("IN_PROGRESS")).toBe("BUYOUT");
    expect(orderPlaceOf("COMPLETED")).toBeNull();
    expect(orderPlaceOf("AWAITING_PAYMENT")).toBeNull();
  });
  it("ошибка: у выкупаемого — set-error + заметка, у ждущего пасс — перенос", () => {
    expect(placeRequests({ status: "PENDING" }, "ERROR", "не та цена")).toEqual({
      requests: [{ action: "set-error" }, { action: "add-note", text: "⚠️ не та цена" }],
    });
    expect(placeRequests({ status: "AWAITING_GAMEPASS" }, "ERROR", "x")).toEqual({
      requests: [{ action: "move-to", target: "ERROR", note: "x" }],
    });
  });
  it("отмена идёт через reject (уведомит покупателя), из отменённых — нельзя повторно", () => {
    expect(placeRequests({ status: "ERROR" }, "REJECTED", "спор")).toEqual({ requests: [{ action: "reject", reason: "спор" }] });
    expect(placeRequests({ status: "REJECTED" }, "REJECTED", "спор")).toEqual({ error: "Заказ уже здесь" });
  });
  it("к выкупу из ошибки — restore-to-buyout; без причины и у замороженного — отказ", () => {
    expect(placeRequests({ status: "ERROR" }, "BUYOUT", "цену поправили")).toMatchObject({ requests: [{ action: "restore-to-buyout" }, { action: "add-note" }] });
    expect(placeRequests({ status: "ERROR" }, "BUYOUT", " ")).toHaveProperty("error");
    expect(placeRequests({ status: "ERROR", heldAt: new Date() }, "BUYOUT", "x")).toHaveProperty("error");
    expect(placeRequests({ status: "COMPLETED" }, "BUYOUT", "x")).toHaveProperty("error");
  });
});
