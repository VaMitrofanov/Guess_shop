/**
 * 🛡 Разморозка админом сильнее автоматики (11.11.2026, 79PT6B3).
 * После ручной разморозки автоматика морозит только по НОВОМУ плохому отзыву
 * или когда деньги ушли покупателю.
 */
import { autoHoldAllowed, holdByCode, releaseByCode } from "../../bots/shared/order-hold";
import { decideGate } from "../../bots/shared/buyout-gate";

const T = (s: string) => new Date(s);

describe("autoHoldAllowed", () => {
  const manual = T("2026-11-10T12:00:00Z");
  it("без ручной разморозки — можно всё", () => {
    expect(autoHoldAllowed(null, "WB_CLAIM")).toBe(true);
    expect(autoHoldAllowed(null, "STALE")).toBe(true);
  });
  it("после ручной — заявка, висяк, частичный возврат и просьба в чате не морозят", () => {
    for (const k of ["WB_CLAIM", "STALE", "PAYMENT_PARTIAL_REFUND", "BUYER_REFUND_REQUEST"] as const) {
      expect(autoHoldAllowed(manual, k, T("2026-11-11T00:00:00Z"))).toBe(false);
    }
  });
  it("отзыв и «деньги ушли» морозят, только если случились позже", () => {
    for (const k of ["BAD_REVIEW", "WB_CANCELLED", "WB_CLAIM_REFUNDED", "PAYMENT_REFUNDED", "CODE_REVOKED"] as const) {
      expect(autoHoldAllowed(manual, k, T("2026-11-11T00:00:00Z"))).toBe(true);
      expect(autoHoldAllowed(manual, k, T("2026-11-09T00:00:00Z"))).toBe(false);
      expect(autoHoldAllowed(manual, k)).toBe(true); // время неизвестно — про деньги переспрашиваем
    }
  });
});

function fakeDb() {
  const state: { hold: any; order: any } = {
    hold: null,
    order: { id: "o1", wbCode: "79PT6B3", adminNote: null, heldAt: null },
  };
  const db: any = {
    orderHold: {
      findUnique: async () => state.hold,
      upsert: async ({ create, update }: any) => {
        state.hold = state.hold ? { ...state.hold, ...update } : { ...create, releasedAt: null };
        return state.hold;
      },
      update: async ({ data }: any) => { Object.assign(state.hold, data); return state.hold; },
    },
    wbOrder: {
      findUnique: async () => state.order,
      update: async ({ data }: any) => { Object.assign(state.order, data); return state.order; },
    },
  };
  return { db, state };
}

describe("холд и разморозка", () => {
  it("ручная разморозка ставит отметку, заявка её не пробивает, гейт её не стирает", async () => {
    const { db, state } = fakeDb();
    await holdByCode(db, { wbCode: "79PT6B3", reason: "Возврат на WB", actor: "автозащита", auto: { kind: "WB_CLAIM" } });
    expect(state.order.heldAt).toBeTruthy();
    await releaseByCode(db, { wbCode: "79PT6B3", actor: "Roblox", manual: true });
    expect(state.order.heldAt).toBeNull();
    expect(state.order.manualReleaseAt).toBeInstanceOf(Date);
    expect(state.order.adminNote).toContain("вручную");

    const again = await holdByCode(db, { wbCode: "79PT6B3", reason: "Возврат на WB", actor: "автозащита", auto: { kind: "WB_CLAIM" } });
    expect(again.skippedByManualRelease).toBe(true);
    expect(state.order.heldAt).toBeNull();

    // Новый ★1 — морозит, отметка остаётся.
    const review = await holdByCode(db, {
      wbCode: "79PT6B3", reason: "плохой отзыв", actor: "гейт выкупа",
      auto: { kind: "BAD_REVIEW", eventAt: new Date(Date.now() + 60_000) },
    });
    expect(review.afterManualRelease).toBe(true);
    expect(state.order.heldAt).toBeTruthy();
    expect(state.hold.manualReleaseAt).toBeInstanceOf(Date);
    // Гейт снял свой замок (отзыв исправили) — отметка жива, заявка снова не морозит.
    await releaseByCode(db, { wbCode: "79PT6B3", actor: "гейт выкупа" });
    expect(state.hold.manualReleaseAt).toBeInstanceOf(Date);
    expect((await holdByCode(db, { wbCode: "79PT6B3", reason: "x", actor: "автозащита", auto: { kind: "WB_CLAIM" } })).skippedByManualRelease).toBe(true);
  });

  it("ручная заморозка — админ передумал: отметка снимается", async () => {
    const { db, state } = fakeDb();
    await holdByCode(db, { wbCode: "79PT6B3", reason: "x", actor: "автозащита", auto: { kind: "WB_CLAIM" } });
    await releaseByCode(db, { wbCode: "79PT6B3", actor: "Demid", manual: true });
    await holdByCode(db, { wbCode: "79PT6B3", reason: "фрод", actor: "Demid" });
    expect(state.hold.manualReleaseAt).toBeNull();
    expect(state.order.manualReleaseAt).toBeNull();
  });
});

describe("гейт после ручной разморозки", () => {
  const order = {
    wbCode: "79PT6B3", createdAt: T("2026-10-01T00:00:00Z"), nmId: 1, buyerName: "Екатерина",
    staleCheck: false, manualReleaseAt: T("2026-11-10T12:00:00Z"),
  };
  const review = (createdDate: string) => ({
    productValuation: 1, createdDate, nmId: 1, userName: "Екатерина",
    productDetails: { nmId: 1 }, text: "плохо",
  }) as any;
  it("старый отзыв и висяк — нет", () => {
    expect(decideGate(order, [review("2026-11-05T00:00:00Z")], T("2026-11-11T00:00:00Z").getTime())).toBeNull();
    expect(decideGate({ ...order, staleCheck: true }, [], T("2026-11-11T00:00:00Z").getTime())).toBeNull();
  });
  it("новый плохой отзыв — да", () => {
    const d = decideGate(order, [review("2026-11-10T18:00:00Z")], T("2026-11-11T00:00:00Z").getTime());
    expect(d?.rule).toBe("bad_review");
  });
});
