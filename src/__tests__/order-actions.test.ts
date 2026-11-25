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
