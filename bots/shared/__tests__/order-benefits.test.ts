/**
 * U3/U4 (риск №25 в docs/security.md): бонус и скидка списываются до оплаты.
 * Раньше компенсации не было ни на одном исходе, а в боте ветка возврата была
 * недостижима (считала бонус из `WbCode`, которой у DIR-заказов не бывает).
 */

type Row = Record<string, any>;

const state: {
  orders: Record<string, Row>;
  users: Record<string, Row>;
  ledger: Row[];
  events: Row[];
} = { orders: {}, users: {}, ledger: [], events: [] };

const tx = {
  wbOrder: {
    findUnique: async ({ where }: any) => state.orders[where.id] ?? null,
    update: async ({ where, data }: any) => Object.assign(state.orders[where.id], data),
    updateMany: async ({ where, data }: any) => {
      const o = state.orders[where.id];
      if (!o) return { count: 0 };
      Object.assign(o, data);
      return { count: 1 };
    },
    findMany: async () => Object.values(state.orders),
  },
  user: {
    findUnique: async ({ where }: any) => state.users[where.id] ?? null,
    update: async ({ where, data }: any) => {
      const u = state.users[where.id];
      for (const [k, v] of Object.entries<any>(data)) {
        if (v && typeof v === "object" && "increment" in v) u[k] += v.increment;
        else u[k] = v;
      }
      return u;
    },
    updateMany: async ({ where, data }: any) => {
      const u = state.users[where.id];
      if (!u) return { count: 0 };
      if (where.balance?.gte !== undefined && u.balance < where.balance.gte) return { count: 0 };
      for (const [k, v] of Object.entries<any>(data)) {
        if (v && typeof v === "object" && "increment" in v) u[k] += v.increment;
        else u[k] = v;
      }
      return { count: 1 };
    },
  },
  bonusLedger: {
    findUnique: async ({ where }: any) =>
      state.ledger.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null,
    create: async ({ data }: any) => {
      state.ledger.push(data);
      return data;
    },
  },
  orderEvent: {
    create: async ({ data }: any) => {
      state.events.push(data);
      return data;
    },
  },
};

jest.mock("../db", () => ({
  db: {
    $transaction: (fn: any) => fn(tx),
    wbOrder: tx.wbOrder,
  },
}));

import { applyBonusDeltaTx, revertOrderBenefits } from "../order-benefits";

beforeEach(() => {
  state.orders = {};
  state.users = {};
  state.ledger = [];
  state.events = [];
});

describe("applyBonusDeltaTx", () => {
  it("меняет баланс через increment и всегда пишет в леджер", async () => {
    state.users.u1 = { id: "u1", balance: 300 };
    const ok = await applyBonusDeltaTx(tx, {
      userId: "u1", deltaRobux: -100, reason: "DIRECT_ORDER_REDEMPTION",
      idempotencyKey: "k1",
    });
    expect(ok).toBe(true);
    expect(state.users.u1.balance).toBe(200);
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0]).toMatchObject({ deltaRobux: -100, balanceAfter: 200 });
  });

  it("повтор с тем же ключом ничего не делает", async () => {
    state.users.u1 = { id: "u1", balance: 300 };
    await applyBonusDeltaTx(tx, { userId: "u1", deltaRobux: -100, reason: "X", idempotencyKey: "k1" });
    const second = await applyBonusDeltaTx(tx, { userId: "u1", deltaRobux: -100, reason: "X", idempotencyKey: "k1" });
    expect(second).toBe(false);
    expect(state.users.u1.balance).toBe(200);
    expect(state.ledger).toHaveLength(1);
  });

  it("не уводит баланс в минус", async () => {
    state.users.u1 = { id: "u1", balance: 50 };
    const ok = await applyBonusDeltaTx(tx, { userId: "u1", deltaRobux: -100, reason: "X", idempotencyKey: "k2" });
    expect(ok).toBe(false);
    expect(state.users.u1.balance).toBe(50);
    expect(state.ledger).toHaveLength(0);
  });
});

describe("revertOrderBenefits", () => {
  it("возвращает и бонус, и скидку, и отмечает заказ", async () => {
    state.users.u1 = { id: "u1", balance: 0, rubleDiscount: 0 };
    state.orders.o1 = {
      id: "o1", userId: "u1", paidAt: null, priceQuoteId: null,
      bonusAppliedRobux: 100, discountAppliedKopecks: 6000, benefitsRevertedAt: null,
    };

    const res = await revertOrderBenefits("o1", { reason: "CANCELLED_BY_CUSTOMER", kind: "DIRECT" });

    expect(res).toEqual({ reverted: true, bonusRobux: 100, discountKopecks: 6000 });
    expect(state.users.u1.balance).toBe(100);
    expect(state.users.u1.rubleDiscount).toBe(60);
    expect(state.orders.o1.benefitsRevertedAt).toBeTruthy();
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0].deltaRobux).toBe(100);
  });

  it("повторная компенсация не удваивает бонус", async () => {
    state.users.u1 = { id: "u1", balance: 0, rubleDiscount: 0 };
    state.orders.o1 = {
      id: "o1", userId: "u1", paidAt: null, priceQuoteId: null,
      bonusAppliedRobux: 100, discountAppliedKopecks: 0, benefitsRevertedAt: null,
    };

    await revertOrderBenefits("o1", { reason: "ABANDONED", kind: "WEB" });
    const second = await revertOrderBenefits("o1", { reason: "BANK_REJECTED", kind: "WEB" });

    expect(second.reverted).toBe(false);
    expect(state.users.u1.balance).toBe(100);
    expect(state.ledger).toHaveLength(1);
  });

  it("оплаченный заказ не компенсируется", async () => {
    state.users.u1 = { id: "u1", balance: 0, rubleDiscount: 0 };
    state.orders.o1 = {
      id: "o1", userId: "u1", paidAt: new Date(), priceQuoteId: null,
      bonusAppliedRobux: 100, discountAppliedKopecks: 0, benefitsRevertedAt: null,
    };

    const res = await revertOrderBenefits("o1", { reason: "ABANDONED", kind: "WEB" });
    expect(res.reverted).toBe(false);
    expect(state.users.u1.balance).toBe(0);
  });

  it("прямой заказ без бонуса и скидки просто помечается", async () => {
    state.users.u1 = { id: "u1", balance: 0, rubleDiscount: 0 };
    state.orders.o1 = {
      id: "o1", userId: "u1", paidAt: null, priceQuoteId: null,
      bonusAppliedRobux: 0, discountAppliedKopecks: 0, benefitsRevertedAt: null,
    };

    const res = await revertOrderBenefits("o1", { reason: "CANCELLED_BY_CUSTOMER", kind: "DIRECT" });
    expect(res.reverted).toBe(false);
    expect(state.orders.o1.benefitsRevertedAt).toBeTruthy();
  });
});
