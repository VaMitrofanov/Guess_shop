/**
 * Проблемный заказ невозможно выкупить (24.10.2026).
 *
 * Случай JR7HTSW: покупатель открыл возврат на WB, алерт пришёл, а заказ
 * остался в очереди выкупа — автобай отличить его от обычного не мог.
 * Тест сторожит две вещи:
 *  1. каждое событие «деньги уходят от нас» ставит заморозку;
 *  2. каждый путь, который тратит робуксы или отмечает выкуп, проверяет
 *     `assertOrderBuyable` ДО траты.
 */

import { readFileSync } from "fs";
import { join } from "path";
import {
  assertOrderBuyable,
  findHardProblem,
  holdForProblem,
  problemHoldReason,
} from "@/lib/order-hold";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

/** Кусок файла от `start` до следующего `end` (или до конца). */
function block(src: string, start: string, end?: string): string {
  const from = src.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = end ? src.indexOf(end, from + start.length) : -1;
  return src.slice(from, to > -1 ? to : undefined);
}

function expectGuardBefore(src: string, spend: string, guard = "assertOrderBuyable") {
  const g = src.indexOf(guard);
  const s = src.indexOf(spend);
  expect(g).toBeGreaterThan(-1);
  expect(s).toBeGreaterThan(-1);
  expect(g).toBeLessThan(s);
}

describe("пути выкупа под гардом", () => {
  const route = read("src/app/api/twa/orders/route.ts");

  it("TWA «Выкупить»", () => {
    expectGuardBefore(block(route, 'if (action === "purchase")', 'if (action === "edit-avito")'), "purchaseGamepassWithCookie");
  });

  it("TWA «Выкуплено» (ручная отметка)", () => {
    expectGuardBefore(block(route, 'if (action === "complete")', 'if (action === "resend-completed-notice")'), 'status: "COMPLETED"');
  });

  it("TWA отметка части разбивки", () => {
    expectGuardBefore(block(route, 'if (action === "mark-split-part")', 'if (action === "reject")'), "purchasedAt: new Date()");
  });

  it("TWA скрипт ручной покупки", () => {
    expectGuardBefore(block(route, 'if (action === "purchase-script")', 'if (action === "attach-gamepass")'), "resolveGamepass");
  });

  it("TWA привязка пасса и создание по ключу (ставят в очередь)", () => {
    expectGuardBefore(block(route, 'if (action === "attach-gamepass")', 'if (action === "create-gamepass-by-key")'), 'status: "PENDING"');
    expect(block(route, 'if (action === "create-gamepass-by-key")', 'if (action === "user-history")')).toContain("assertOrderBuyable");
  });

  it("покупка найденного пасса мимо очереди", () => {
    const src = read("src/app/api/twa/roblox-account/purchase/route.ts");
    expectGuardBefore(block(src, "export async function POST"), "purchaseGamepassWithCookie(cookie");
  });

  it("автовыкуп", () => {
    expectGuardBefore(block(read("bots/tg/auto-workers.ts"), "for (const order of orders)"), "purchaseGamepassVerified(");
  });

  it("TG-бот: выкуп и «✅ Выкуплено»", () => {
    const handlers = read("bots/tg/handlers.ts");
    expectGuardBefore(block(handlers, 'if (data.startsWith("pb:"))'), "purchaseGamepassVerified(");
    expectGuardBefore(block(handlers, 'if (data.startsWith("admin_ok:"))'), 'status: "COMPLETED"');
  });

  it("TG-хаб: массовое «выполнено» пропускает замороженные", () => {
    const hub = block(read("bots/tg/admin/hub-orders.ts"), "export async function confirmBatchFulfill");
    expect(hub).toContain("...NOT_HELD");
    expectGuardBefore(hub, 'status: "COMPLETED"');
  });

  it("каждый файл, который тратит робуксы на заказ, знает гард", () => {
    // Не про заказы: слив донора, задачи партнёра и закупка у поставщика.
    const exempt = new Set([
      "src/app/api/twa/drain/route.ts",
      "src/app/api/twa/partners/[slug]/tasks/route.ts",
      "bots/tg/admin/hub-autobuy.ts",
    ]);
    const spenders = [
      "src/app/api/twa/orders/route.ts",
      "src/app/api/twa/roblox-account/purchase/route.ts",
      "bots/tg/auto-workers.ts",
      "bots/tg/handlers.ts",
      ...exempt,
    ];
    for (const file of spenders) {
      if (exempt.has(file)) continue;
      expect(read(file)).toContain("assertOrderBuyable");
    }
  });
});

describe("события «деньги уходят» ставят заморозку", () => {
  const sync = read("bots/shared/wb-delivery-sync.ts");

  it("заявка на возврат на WB", () => {
    const claims = block(sync, "async function syncBuyerClaims", "async function remindUnopenedGates");
    expectGuardBefore(claims, "notifyWbBuyerClaim(", "claimHold(");
    expect(sync).toContain('holdForProblem(db, { wbCode: code, kind: refunded ? "WB_CLAIM_REFUNDED" : kind');
  });

  it("отказ в возврате заморозку не снимает", () => {
    const claims = block(sync, "async function syncBuyerClaims", "async function remindUnopenedGates");
    expect(claims).not.toContain("releaseByCode");
  });

  it("отмена на WB — на всех исходах, кроме выкупленного", () => {
    const cancel = block(sync, "async function propagateCancellation", "async function syncStatuses");
    expect(cancel).toContain('kind: "WB_CANCELLED"');
    expect(cancel).toContain('outcome !== "already_delivered"');
  });

  it("возврат платежа Т-Банка: webhook и ручная кнопка", () => {
    const webhook = read("src/app/api/webhooks/tinkoff/route.ts");
    expect(webhook).toContain("PAYMENT_PARTIAL_REFUND");
    expect(webhook).toContain("holdForProblem(");
    const refund = read("src/app/api/twa/payments/refund/route.ts");
    expectGuardBefore(refund, "cancelCanonicalTinkoffPayment({", "holdForProblem(");
  });
});

/* ── Логика на подставной базе ──────────────────────────────────────────── */

type Row = Record<string, any>;

function fakeDb(state: {
  order?: Row | null;
  hold?: Row | null;
  code?: Row | null;
  dbs?: Row | null;
  payments?: Row[];
}) {
  const calls: { holds: Row[] } = { holds: [] };
  const db: any = {
    wbOrder: {
      findUnique: async ({ where }: any) => {
        if (!state.order) return null;
        if (where.id && where.id !== state.order.id) return null;
        if (where.wbCode && where.wbCode !== state.order.wbCode) return null;
        return state.order;
      },
      update: async ({ data }: any) => {
        Object.assign(state.order!, data);
        return state.order;
      },
    },
    orderHold: {
      findUnique: async () => state.hold ?? null,
      upsert: async ({ create }: any) => {
        calls.holds.push(create);
        state.hold = { ...create, releasedAt: null };
        return state.hold;
      },
    },
    wbCode: { findUnique: async () => state.code ?? null },
    wbMarketplaceOrder: { findFirst: async () => state.dbs ?? null },
    paymentAttempt: { findMany: async () => state.payments ?? [] },
  };
  return { db, calls, state };
}

const baseOrder = () => ({ id: "o1", wbCode: "JR7HTSW", status: "PENDING", adminNote: null, heldAt: null, heldReason: null });

describe("assertOrderBuyable", () => {
  it("обычный заказ можно выкупать", async () => {
    const { db } = fakeDb({ order: baseOrder() });
    expect(await assertOrderBuyable(db, "o1")).toEqual({ held: false });
  });

  it("открытая заявка на возврат блокирует и сама ставит заморозку", async () => {
    const { db, calls, state } = fakeDb({
      order: baseOrder(),
      dbs: { cancelledAt: null, claimOpenedAt: new Date(), claimResolvedAt: null, claimReason: "прошу вернуть деньги" },
    });
    const res = await assertOrderBuyable(db, "o1");
    expect(res.held).toBe(true);
    expect(calls.holds).toHaveLength(1);
    expect(calls.holds[0].reason).toContain("Возврат на WB");
    expect(calls.holds[0].reason).toContain("прошу вернуть деньги");
    expect(state.order!.heldAt).toBeInstanceOf(Date);
  });

  it("решённая заявка (отказ в возврате) сама по себе не блокирует — решает человек", async () => {
    const { db } = fakeDb({
      order: baseOrder(),
      dbs: { cancelledAt: null, claimOpenedAt: new Date(), claimResolvedAt: new Date(), claimReason: null },
    });
    expect((await assertOrderBuyable(db, "o1")).held).toBe(false);
  });

  it("отмена на WB, аннулированный код, полный возврат платежа", async () => {
    for (const extra of [
      { dbs: { cancelledAt: new Date() } },
      { code: { status: "REVOKED" } },
      { payments: [{ status: "REFUNDED" }] },
    ]) {
      const { db } = fakeDb({ order: baseOrder(), ...extra });
      expect((await assertOrderBuyable(db, "o1")).held).toBe(true);
    }
  });

  it("частичный возврат — мягкая проблема: блокирует только заморозка", async () => {
    const { db } = fakeDb({ order: baseOrder(), payments: [{ status: "PARTIALLY_REFUNDED" }] });
    expect((await assertOrderBuyable(db, "o1")).held).toBe(false);
  });

  it("заморозка блокирует, как и раньше", async () => {
    const { db } = fakeDb({ order: { ...baseOrder(), heldAt: new Date(), heldReason: "1 звезда" } });
    const res = await assertOrderBuyable(db, "o1");
    expect(res.held).toBe(true);
  });

  it("отклонённый заказ не выкупается, но привязка пасса его поднимает", async () => {
    const { db } = fakeDb({ order: { ...baseOrder(), status: "REJECTED" } });
    expect((await assertOrderBuyable(db, "o1")).held).toBe(true);
    expect((await assertOrderBuyable(db, "o1", { allowRejected: true })).held).toBe(false);
  });
});

describe("holdForProblem", () => {
  it("морозит по коду, даже если заказа ещё нет", async () => {
    const { db, calls } = fakeDb({ order: null });
    const res = await holdForProblem(db, { wbCode: "jr7htsw", kind: "WB_CLAIM", detail: "не получилось" });
    expect(res.ok).toBe(true);
    expect(res.awaitingOrder).toBe(true);
    expect(calls.holds[0].wbCode).toBe("JR7HTSW");
  });

  it("выкупленный заказ не морозит — тратить уже нечего", async () => {
    const { db, calls } = fakeDb({ order: { ...baseOrder(), status: "COMPLETED" } });
    const res = await holdForProblem(db, { wbCode: "JR7HTSW", kind: "WB_CLAIM" });
    expect(res.alreadyCompleted).toBe(true);
    expect(calls.holds).toHaveLength(0);
  });

  it("причина читается и не длиннее лимита", () => {
    expect(problemHoldReason("WB_CANCELLED")).toBe("Заказ отменён на WB — деньги вернулись покупателю");
    expect(problemHoldReason("WB_CLAIM", "x".repeat(1000)).length).toBeLessThanOrEqual(300);
  });

  it("findHardProblem не видит проблем у чистого заказа", async () => {
    const { db } = fakeDb({ order: baseOrder() });
    expect(await findHardProblem(db, { id: "o1", wbCode: "JR7HTSW" })).toBeNull();
  });
});
