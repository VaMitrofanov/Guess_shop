import fs from "fs";
import path from "path";
import { directPatchForSource, isDirectSource } from "@/lib/order-direct";

const now = new Date("2026-10-19T04:00:00Z");
const opts = { now, actor: "Roblox", directSaleKopecks: 133_000 };

describe("прямой заказ: источник и признак меняются вместе", () => {
  test("ручной WB → DIRECT становится прямым и оплаченным (MN-MVF55KPOH1BY)", () => {
    const patch = directPatchForSource(
      { orderSource: "WB", isDirectOrder: false, paidAt: null, saleAmountKopecks: null, paymentDetails: null },
      "DIRECT", opts,
    );
    expect(patch.isDirectOrder).toBe(true);
    expect(patch.paidAt).toEqual(now);
    expect(patch.saleAmountKopecks).toBe(133_000);
    expect(patch.paymentDetails).toMatch(/Roblox/);
  });

  test("уже записанную оплату и сумму не трогает", () => {
    const paidAt = new Date("2026-10-01");
    const patch = directPatchForSource(
      { orderSource: "MANUAL", isDirectOrder: false, paidAt, saleAmountKopecks: 99_00, paymentDetails: "x" },
      "DIRECT", opts,
    );
    expect(patch).toEqual({ isDirectOrder: true });
  });

  test("уход из DIRECT снимает признак", () => {
    expect(directPatchForSource(
      { orderSource: "DIRECT", isDirectOrder: true, paidAt: now }, "WB", opts,
    )).toEqual({ isDirectOrder: false });
  });

  test("без изменения природы — пустой патч", () => {
    expect(directPatchForSource({ orderSource: "WB", isDirectOrder: false, paidAt: null }, "MANUAL", opts)).toEqual({});
    expect(isDirectSource("SITE")).toBe(true);
    expect(isDirectSource("WB_DBS")).toBe(false);
  });

  test("роут заказов не пишет orderSource без синхронизации признака", () => {
    const src = fs.readFileSync(path.join(__dirname, "../app/api/twa/orders/route.ts"), "utf8");
    // Каждое присваивание источника из переменной (правка, set-source) идёт рядом с directPatchForSource.
    const edits = src.match(/data\.orderSource = src;[\s\S]{0,600}/g) ?? [];
    expect(edits.length).toBeGreaterThan(0);
    for (const block of edits) expect(block).toContain("directPatchForSource");
    expect(src).toMatch(/orderSource: src,\s*\.\.\.directPatchForSource/);
  });
});

describe("сужение «молчат / не достучались»", () => {
  test("parseNarrow принимает новые значения и отсекает мусор", async () => {
    const { parseNarrow, buildNarrowWhere } = await import("@/lib/order-slices");
    expect(parseNarrow(new URLSearchParams("blocked=silent")).blocked).toBe("silent");
    expect(parseNarrow(new URLSearchParams("blocked=unreached")).blocked).toBe("unreached");
    expect(parseNarrow(new URLSearchParams("blocked=drop")).blocked).toBeNull();
    expect(buildNarrowWhere("AWAITING_LINK", { blocked: "silent" })).toEqual({ AND: [{ remindersSent: { gte: 3 } }] });
  });
});
