/* eslint-disable @typescript-eslint/no-explicit-any -- compact in-memory Prisma double */
type Row = Record<string, any>;

const state: { order: Row; attempt: Row; user: Row; ledger: Row[]; events: Row[]; outbox: Row[] } = {
  order: {}, attempt: {}, user: {}, ledger: [], events: [], outbox: [],
};

function applyData(target: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in value) target[key] = (target[key] ?? 0) + value.increment;
    else if (value && typeof value === "object" && "decrement" in value) target[key] = (target[key] ?? 0) - value.decrement;
    else target[key] = value;
  }
}

const tx = {
  wbOrder: {
    findMany: jest.fn(async () => [{
      id: state.order.id,
      status: state.order.status,
      paymentAttempts: [state.attempt],
    }]),
    findUnique: jest.fn(async () => state.order),
    update: jest.fn(async ({ data }: Row) => { applyData(state.order, data); return state.order; }),
    updateMany: jest.fn(async ({ data }: Row) => { applyData(state.order, data); return { count: 1 }; }),
  },
  paymentAttempt: {
    findUnique: jest.fn(async () => ({ ...state.attempt, orderId: state.order.id, order: state.order })),
    updateMany: jest.fn(async ({ data }: Row) => { applyData(state.attempt, data); return { count: 1 }; }),
    findFirst: jest.fn(async () => null),
  },
  user: {
    findUnique: jest.fn(async () => state.user),
    update: jest.fn(async ({ data }: Row) => { applyData(state.user, data); return state.user; }),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      if (where.balance?.gte !== undefined && state.user.balance < where.balance.gte) return { count: 0 };
      if (where.rubleDiscount?.gte !== undefined && state.user.rubleDiscount < where.rubleDiscount.gte) return { count: 0 };
      applyData(state.user, data);
      return { count: 1 };
    }),
  },
  bonusLedger: {
    findUnique: jest.fn(async ({ where }: Row) => state.ledger.find((row) => row.idempotencyKey === where.idempotencyKey) ?? null),
    create: jest.fn(async ({ data }: Row) => { state.ledger.push(data); return data; }),
  },
  orderEvent: {
    create: jest.fn(async ({ data }: Row) => { state.events.push(data); return data; }),
    upsert: jest.fn(async ({ where, create }: Row) => {
      const existing = state.events.find((row) => row.idempotencyKey === where.idempotencyKey);
      if (existing) return existing;
      const event = { id: `event-${state.events.length + 1}`, ...create };
      state.events.push(event);
      return event;
    }),
  },
  outboxMessage: {
    upsert: jest.fn(async ({ create }: Row) => { state.outbox.push(create); return create; }),
  },
};

jest.mock("../db", () => ({
  db: {
    $transaction: (fn: (client: typeof tx) => unknown) => fn(tx),
    wbOrder: tx.wbOrder,
  },
}));

const getState = jest.fn();
const cancelSession = jest.fn();
jest.mock("../tbank-payment", () => ({
  getTbankPaymentState: (...args: unknown[]) => getState(...args),
  cancelTbankPaymentSession: (...args: unknown[]) => cancelSession(...args),
  staleProviderPaymentNeedsCancel: (status: string) => status === "NEW",
  internalPaymentStatus: (status: string) => ({
    CANCELED: "CANCELED",
    CONFIRMED: "CONFIRMED",
  })[status] ?? null,
}));

import { sweepStaleWebOrders } from "../order-benefits";

beforeEach(() => {
  jest.clearAllMocks();
  state.user = { id: "user-1", balance: 100, rubleDiscount: 25 };
  state.order = {
    id: "order-1", userId: "user-1", status: "PAYMENT_PENDING", paidAt: null,
    priceQuoteId: "quote-1", publicOrderId: "RB-1", bonusAppliedRobux: 0,
    discountAppliedKopecks: 0, benefitsRevertedAt: null, benefitsRevision: 0,
  };
  state.attempt = {
    id: "attempt-1", status: "INITIATED", paymentId: "pay-1", publicOrderId: "RB-1",
    amountKopecks: 16_000, createdAt: new Date("2026-08-09T06:00:00Z"),
  };
  state.ledger = [];
  state.events = [];
  state.outbox = [];
});

it("cancels the provider session before rejecting an abandoned order", async () => {
  getState.mockResolvedValue({ paymentId: "pay-1", status: "NEW" });
  cancelSession.mockResolvedValue({ paymentId: "pay-1", status: "CANCELED" });

  const result = await sweepStaleWebOrders(new Date("2026-08-09T10:00:00Z").getTime());

  expect(cancelSession).toHaveBeenCalledWith("pay-1");
  expect(state.attempt.status).toBe("CANCELED");
  expect(state.order.status).toBe("REJECTED");
  expect(result).toMatchObject({ swept: 1, reconciled: 0, deferred: 0 });
});

it("re-reserves returned benefits before a late confirmed order reaches buyout", async () => {
  state.order.status = "REJECTED";
  state.order.bonusAppliedRobux = 100;
  state.order.discountAppliedKopecks = 2_500;
  state.order.benefitsRevertedAt = new Date("2026-08-09T08:00:00Z");
  getState.mockResolvedValue({ paymentId: "pay-1", status: "CONFIRMED" });

  const result = await sweepStaleWebOrders(new Date("2026-08-09T10:00:00Z").getTime());

  expect(state.user).toMatchObject({ balance: 0, rubleDiscount: 0 });
  expect(state.order).toMatchObject({ status: "PENDING", benefitsRevertedAt: null, benefitsRevision: 1 });
  expect(state.ledger[0]).toMatchObject({ deltaRobux: -100, idempotencyKey: "web-order-bonus-late-payment:attempt-1" });
  expect(state.outbox[0]).toMatchObject({ topic: "payment.confirmed" });
  expect(result).toMatchObject({ reconciled: 1, manual: 0 });
});
