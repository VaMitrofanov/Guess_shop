import { classifySales, closeRefundedOrder, moneyBySrid, refundClosesOrder, type ReconcileOrder } from "../wb-sales-reconcile";

const now = new Date("2026-11-12T12:00:00Z");
const DBS = "Склад продавца";
const sale = (srid: string, saleID: string, date = "2026-11-01T10:00:00", warehouseType = DBS) =>
  ({ srid, saleID, date, nmId: 1, priceWithDisc: 485, warehouseType });
const order = (rid: string, over: Partial<ReconcileOrder> = {}): ReconcileOrder => ({
  id: rid, rid, wbOrderId: "W" + rid, buyerName: "Светлана", nmId: 1, denomination: 500,
  code: "ABCDEFG", cancelledAt: null, internalStatus: "PENDING", ...over,
});

describe("сверка денег WB с выдачей", () => {
  it("оплаченный заказ без кода — находка (6254423598, 12.11.2026)", () => {
    const money = moneyBySrid([sale("a", "S1")]);
    const f = classifySales(money, new Map([["a", order("a", { code: null, internalStatus: null })]]), now);
    expect(f.map((x) => x.kind)).toEqual(["SALE_NO_CODE"]);
  });

  it("свежая продажа ещё не находка: заказ синхронизируется", () => {
    const money = moneyBySrid([sale("a", "S1", "2026-11-12T14:30:00")]);
    expect(classifySales(money, new Map(), now)).toEqual([]);
  });

  it("продажа без заказа — только со склада продавца; физическая карта со склада WB — не потеря", () => {
    const money = moneyBySrid([sale("dbs", "S1"), sale("fbo", "S2", undefined, "Склад WB")]);
    expect(classifySales(money, new Map(), now).map((x) => x.money.srid)).toEqual(["dbs"]);
  });

  it("возврат при открытом заказе — заморозка; после выкупа — отдельная находка; сторно снимает", () => {
    const money = moneyBySrid([
      sale("open", "S1"), sale("open", "R1", "2026-11-10T10:00:00"),
      sale("done", "S2"), sale("done", "R2"),
      sale("storno", "S3"), sale("storno", "R3"), sale("storno", "B3"),
    ]);
    const orders = new Map([
      ["open", order("open", { internalStatus: "AWAITING_GAMEPASS" })],
      ["done", order("done", { internalStatus: "COMPLETED" })],
      ["storno", order("storno")],
    ]);
    const kinds = Object.fromEntries(classifySales(money, orders, now).map((x) => [x.money.srid, x.kind]));
    expect(kinds).toEqual({ open: "REFUND_OPEN", done: "REFUND_AFTER_DELIVERY" });
  });

  it("отменённый на WB и не наш номинал не дублируют старую защиту", () => {
    const money = moneyBySrid([sale("c", "S1"), sale("c", "R1"), sale("x", "S2")]);
    const orders = new Map([
      ["c", order("c", { cancelledAt: new Date() })],
      ["x", order("x", { denomination: null, code: null })],
    ]);
    expect(classifySales(money, orders, now)).toEqual([]);
  });

  it("фильтр по своим карточкам", () => {
    expect(moneyBySrid([sale("a", "S1")], new Set([2])).size).toBe(0);
  });

  describe("возврат по статистике закрывает невыкупленный заказ (VV7AMZU, 16.11.2026)", () => {
    function fakeDb(status: string) {
      const state = { status, codeStatus: "CLAIMED", gateState: "SENT", held: false };
      const db: any = {
        wbOrder: {
          findUnique: jest.fn(async () => ({ id: "o1", status: state.status, adminNote: "старая заметка" })),
          update: jest.fn(async () => ({})),
          updateMany: jest.fn(async ({ where, data }: any) => {
            if (where.status !== state.status) return { count: 0 };
            state.status = data.status;
            return { count: 1 };
          }),
        },
        wbMarketplaceOrder: {
          findUnique: jest.fn(async () => ({
            id: "m1", cancelledAt: null, gateState: state.gateState,
            wbCode: { id: "c1", code: "VV7AMZU", status: state.codeStatus, isUsed: true },
          })),
          update: jest.fn(async ({ data }: any) => { state.gateState = data.gateState; }),
        },
        wbCode: { update: jest.fn(async ({ data }: any) => { state.codeStatus = data.status; }) },
        orderHold: {
          findUnique: jest.fn(async () => null),
          upsert: jest.fn(async () => { state.held = true; return {}; }),
        },
        $transaction: jest.fn(async (ops: any) => (typeof ops === "function" ? ops(db) : Promise.all(ops))),
      };
      return { db, state };
    }
    const finding = (internalStatus: string | null) => ({
      kind: "REFUND_OPEN" as const,
      money: moneyBySrid([sale("r", "S1"), sale("r", "R674250746", "2026-11-10T18:20:03")]).get("r")!,
      order: order("r", { code: "VV7AMZU", internalStatus }),
    });

    it("ждёт пасс → REJECTED, код аннулирован", async () => {
      const { db, state } = fakeDb("AWAITING_GAMEPASS");
      expect(await closeRefundedOrder(db, finding("AWAITING_GAMEPASS"))).toBe("rejected");
      expect(state.status).toBe("REJECTED");
      expect(state.codeStatus).toBe("REVOKED");
      expect(state.gateState).toBe("REVOKED");
      const note = db.wbOrder.updateMany.mock.calls[0][0].data.adminNote as string;
      expect(note.startsWith("[WB ВОЗВРАТ")).toBe(true);
      expect(note).toContain("R674250746");
      expect(note).toContain("старая заметка");
    });

    it("выкуп в работе или в ошибке — не трогаем: решает человек", async () => {
      for (const status of ["IN_PROGRESS", "ERROR"]) {
        const { db, state } = fakeDb(status);
        expect(await closeRefundedOrder(db, finding(status))).toBe("skipped");
        expect(state.status).toBe(status);
        expect(state.codeStatus).toBe("CLAIMED");
        expect(refundClosesOrder(finding(status).order)).toBe(false);
      }
      expect(refundClosesOrder(finding("PENDING").order)).toBe(true);
    });
  });
});
