/**
 * 🏷 Пометки заказа (11.11.2026): видны, выкуп не блокируют, «✓ Договорились»
 * гасит, но не удаляет. Плюс состав сигналов, который рисуют TWA и сайт.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { ackFlags, flagsConfirmText, openFlags, setFlag } from "../../bots/shared/order-flags";
import { orderSignals, signalChips } from "@/lib/order-signals";
import { buildTabWhere, TAB_SQL } from "@/lib/order-queue";

function fakeDb(order: any) {
  const db: any = {
    wbOrder: {
      findUnique: async () => order,
      update: async ({ data }: any) => Object.assign(order, data),
    },
  };
  return db;
}

describe("setFlag / ackFlags", () => {
  it("идемпотентна, погашенная остаётся погашенной, flaggedAt следует за нерешёнными", async () => {
    const order: any = { id: "o1", wbCode: "79PT6B3", flags: null };
    const db = fakeDb(order);
    expect((await setFlag(db, { wbCode: "79pt6b3", kind: "CLAIM", detail: "начислено 500 вместо 1000" })).added).toBe(true);
    expect((await setFlag(db, { wbCode: "79PT6B3", kind: "CLAIM", detail: "начислено 500 вместо 1000" })).added).toBe(false);
    expect(order.flags).toHaveLength(1);
    expect(order.flaggedAt).toBeInstanceOf(Date);

    await ackFlags(db, { orderId: "o1", actor: "Demid" });
    expect(openFlags(order)).toHaveLength(0);
    expect(order.flaggedAt).toBeNull();
    expect(order.flags[0].ackBy).toBe("Demid");

    // Повторный сигнал договорённость не отменяет.
    await setFlag(db, { wbCode: "79PT6B3", kind: "CLAIM", detail: "ещё раз" });
    expect(openFlags(order)).toHaveLength(0);
  });

  it("заказа ещё нет — ждём (свип syncClaimFlags догонит)", async () => {
    expect((await setFlag(fakeDb(null), { wbCode: "X", kind: "CLAIM" })).awaitingOrder).toBe(true);
  });

  it("подтверждение перед выкупом только при нерешённых", () => {
    const at = new Date().toISOString();
    expect(flagsConfirmText({ flags: [] })).toBeNull();
    expect(flagsConfirmText({ flags: [{ kind: "CLAIM", at, detail: "верните" }] })).toContain("Возврат открыт");
    expect(flagsConfirmText({ flags: [{ kind: "CLAIM", at, ackAt: at }] })).toBeNull();
  });
});

describe("сигналы заказа", () => {
  const at = new Date(Date.now() - 3 * 3600_000).toISOString();
  it("порядок: заморозка → пометки → вручную → решённые; в ленте только блок и нерешённое", () => {
    const sig = orderSignals({
      heldAt: at, heldReason: "плохой отзыв", heldBy: "гейт выкупа",
      flags: [{ kind: "STALE", at }, { kind: "CLAIM", at, ackAt: at, ackBy: "Demid" }],
      createdAt: new Date(Date.now() - 24 * 86_400_000).toISOString(),
    });
    expect(sig.map(s => s.state)).toEqual(["block", "attention", "resolved"]);
    expect(sig[1].chip).toBe("⏳ Висит 24 дн.");
    expect(sig[2].meta).toContain("Demid");
    expect(signalChips({ flags: [{ kind: "CLAIM", at, ackAt: at }] })).toHaveLength(0);
  });
  it("разморожен вручную — справка без действия", () => {
    const [s] = orderSignals({ manualReleaseAt: at, manualReleaseBy: "Roblox" });
    expect(s.state).toBe("info");
    expect(s.action).toBeUndefined();
  });
});

describe("срез «С пометками» и автовыкуп", () => {
  it("срез исключает замороженные и закрытые", () => {
    expect(TAB_SQL.FLAGGED).toContain('"flaggedAt" IS NOT NULL');
    expect(TAB_SQL.FLAGGED).toContain('"heldAt" IS NULL');
    expect(buildTabWhere("FLAGGED")).toMatchObject({ flaggedAt: { not: null }, heldAt: null });
  });
  it("автовыкуп не берёт заказ с нерешённой пометкой", () => {
    const src = readFileSync(join(process.cwd(), "bots/tg/auto-workers.ts"), "utf8");
    expect(src).toContain("flaggedAt: null");
  });
  it("висяк гейта ставит пометку, а не заморозку", () => {
    const src = readFileSync(join(process.cwd(), "bots/shared/wb-delivery-sync.ts"), "utf8");
    expect(src).toContain('if (decision?.rule === "stale")');
    expect(src).toContain('setFlag(db, { wbCode, kind: "STALE" })');
  });
});
