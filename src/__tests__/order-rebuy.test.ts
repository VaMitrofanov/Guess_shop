import { buildRebuyData } from "@/lib/order-recovery";
import { canRebuy, orderBadge, orderFlag, primaryActionFor, type PresentableOrder } from "@/lib/order-presentation";

/* 🔁 Перевыкуп (DNZ5WLR, 01.11.2026): выкупленный заказ, который не дошёл до
   покупателя, возвращается в очередь первым и с меткой. */

const completed = {
  status: "COMPLETED",
  wbCode: "DNZ5WLR",
  gamepassUrl: "https://www.roblox.com/game-pass/2044658912",
  isDirectOrder: false,
  paidAt: null,
  adminNote: "[УВЕД 2026-10-24 17:21] TG: покупатель извещён о выкупе",
  heldAt: null,
  completedAt: new Date("2026-10-24T17:21:36Z"),
  purchaserUsername: null,
};

describe("buildRebuyData", () => {
  const now = new Date("2026-11-01T10:00:00Z");

  it("COMPLETED → PENDING, первым, с меткой и причиной", () => {
    const r = buildRebuyData(completed, "  прислал скрин — робуксов нет ", "Вадим", now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.status).toBe("PENDING");
    expect(r.data.priorityAt).toEqual(now);
    expect(r.data.pendingAt).toEqual(now);
    expect(r.data.rebuyAt).toEqual(now);
    expect(r.data.rebuyReason).toBe("прислал скрин — робуксов нет");
    expect(r.data.completedAt).toBeNull();
    expect(r.data.robuxUnlockRemindLevel).toBe(0);
    // История не стирается: прошлые строки на месте, новая — в конце.
    expect(r.data.adminNote.startsWith("[УВЕД 2026-10-24")).toBe(true);
    expect(r.data.adminNote).toContain("[ПЕРЕВЫКУП 2026-11-01 от Вадим] COMPLETED→PENDING (закрыт 2026-10-24, вручную): прислал скрин");
  });

  it("называет, кто закрывал в прошлый раз", () => {
    const r = buildRebuyData({ ...completed, closedBy: "Demid" }, "не дошло", "Вадим", now);
    expect(r.ok && r.data.adminNote).toContain("(закрыт 2026-10-24 Demid, вручную)");
  });

  it("называет аккаунт прошлого выкупа — тот же пасс им не купить", () => {
    const r = buildRebuyData({ ...completed, purchaserUsername: "buyer_acc_7" }, "не дошло", "Вадим", now);
    expect(r.ok && r.data.adminNote).toContain("аккаунт buyer_acc_7");
  });

  it("без причины не возвращает", () => {
    expect(buildRebuyData(completed, "   ", "Вадим", now)).toMatchObject({ ok: false, status: 400 });
    expect(buildRebuyData(completed, undefined, "Вадим", now)).toMatchObject({ ok: false, status: 400 });
  });

  it("только из «Готово»", () => {
    for (const status of ["PENDING", "ERROR", "REJECTED", "AWAITING_GAMEPASS"])
      expect(buildRebuyData({ ...completed, status }, "x", "Вадим", now)).toMatchObject({ ok: false, status: 400 });
  });

  it("замороженный не поднимается", () => {
    expect(buildRebuyData({ ...completed, heldAt: now }, "x", "Вадим", now)).toMatchObject({ ok: false, status: 409 });
  });

  it("без пасса выкупать нечего, а разбитый заказ — можно", () => {
    expect(buildRebuyData({ ...completed, gamepassUrl: null }, "x", "Вадим", now)).toMatchObject({ ok: false, status: 409 });
    expect(buildRebuyData({ ...completed, gamepassUrl: null, splitCount: 2 }, "x", "Вадим", now).ok).toBe(true);
  });
});

const base: PresentableOrder = {
  amount: 500,
  status: "PENDING",
  wbCode: "DNZ5WLR",
  gamepassUrl: "https://www.roblox.com/game-pass/2044658912",
  heldAt: null,
  isDirectOrder: false,
  isFavorite: true,
  orderSource: "WB_DBS",
  buyoutErrorCode: null,
  createdAt: new Date(Date.now() - 9 * 86400_000).toISOString(),
  pendingAt: new Date().toISOString(),
  robloxUsername: "77KIR7",
  rebuyAt: new Date().toISOString(),
  rebuyReason: "прислал скрин",
};

describe("метка перевыкупа", () => {
  it("в очереди видна бейджем и строкой с причиной", () => {
    expect(orderBadge(base)).toEqual({ label: "🔁 Перевыкуп", tone: "pink" });
    expect(orderFlag(base)).toEqual({ text: "🔁 не дошло: прислал скрин", tone: "pink" });
    // Главное действие то же, что у любого заказа в очереди.
    expect(primaryActionFor(base)?.action).toBe("complete");
  });

  it("после повторного выкупа — снова «Готово»", () => {
    const done = { ...base, status: "COMPLETED", isFavorite: false };
    expect(orderBadge(done)?.label).toBe("Готово");
    expect(orderFlag(done)).toBeNull();
  });

  it("заморозка сильнее перевыкупа", () => {
    expect(orderBadge({ ...base, heldAt: new Date().toISOString() })?.label).toBe("❄️ Заморожен");
  });

  it("кнопка — только у выкупленного, не замороженного, с пассом", () => {
    const done = { ...base, status: "COMPLETED" };
    expect(canRebuy(done)).toBe(true);
    expect(canRebuy(base)).toBe(false);
    expect(canRebuy({ ...done, heldAt: new Date().toISOString() })).toBe(false);
    expect(canRebuy({ ...done, gamepassUrl: null })).toBe(false);
  });
});

describe("правка выкупленного заказа (10.11.2026)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const route: string = require("fs").readFileSync(require("path").join(process.cwd(), "src/app/api/twa/orders/route.ts"), "utf8");
  const edit = route.slice(route.indexOf('if (action === "edit-order")'), route.indexOf('if (action === "set-source")'));

  it("принимает COMPLETED, но статус и номинал не трогает", () => {
    expect(edit).toContain('"COMPLETED"].includes(order.status)');
    expect(edit).toContain("if (completedEdit) { /* статус не трогаем */ }");
    expect(edit).toContain("completedEdit && amt !== order.amount");
  });
});
