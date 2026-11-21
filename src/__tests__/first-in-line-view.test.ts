import {
  FIRST_GROUPS, firstAgeBasis, firstCopyableIds, firstCopyToast, firstHiddenCount, firstMetaLine,
  firstNoteText, firstReadiness, groupFirstInLine, rebuyWasFromNote,
} from "@/lib/first-in-line-view";
import type { FirstInLineOrder } from "@/types/first-in-line";

const row = (patch: Partial<FirstInLineOrder> = {}): FirstInLineOrder => ({
  id: "o1", wbCode: "DNZ5WLR", robloxUsername: "77KIR7", amount: 500, gross: 715, lane: "WB_DBS",
  status: "PENDING", since: "2026-11-01T10:00:00Z", createdAt: "2026-10-21T19:36:27Z",
  gamepassId: "2044658912", gamepassIds: ["2044658912"], note: null, reason: "rebuy", ...patch,
});

describe("«Первым делом»: группы", () => {
  it("порядок групп фиксирован: не дошло → торопят → подняты → прямые; пустые не рисуются", () => {
    expect(FIRST_GROUPS.map(g => g.id)).toEqual(["rebuy", "rush", "pinned", "direct"]);
    const groups = groupFirstInLine([row({ id: "d", reason: "direct" }), row({ id: "r" })]);
    expect(groups.map(g => g.group.id)).toEqual(["rebuy", "direct"]);
  });

  it("перевыкуп розовый, не оранжевый (оранжевый — Авито)", () => {
    expect(FIRST_GROUPS[0].tone).toBe("pink");
  });
});

describe("«Первым делом»: возраст и откуда заказ", () => {
  it("перевыкуп считает от создания заказа, остальные — от очереди", () => {
    expect(firstAgeBasis(row())).toBe("2026-10-21T19:36:27Z");
    expect(firstAgeBasis(row({ reason: "pinned" }))).toBe("2026-11-01T10:00:00Z");
  });

  it("строка «был:» берётся из последней записи перевыкупа", () => {
    const note = [
      "[УВЕД 2026-10-24 17:21] TG: покупатель извещён о выкупе",
      "[ПЕРЕВЫКУП 2026-11-01 от Вадим] COMPLETED→PENDING (закрыт 2026-10-24 Demid, вручную): прислал скрин",
    ].join("\n");
    expect(rebuyWasFromNote(note)).toBe("закрыт 24.10 Demid, вручную");
    expect(rebuyWasFromNote("нет такой строки")).toBeNull();
    expect(firstMetaLine(row({ rebuyWas: "закрыт 24.10 Demid, вручную" }))).toBe("был: закрыт 24.10 Demid, вручную");
    expect(firstMetaLine(row({ reason: "pinned", priorityBy: "Demid", priorityAt: "2026-10-31T11:05:53Z" }))).toBe("⚡ Demid, 31.10");
    expect(firstMetaLine(row({ reason: "direct" }))).toBeNull();
  });

  it("пустая заметка перевыкупа показывает причину", () => {
    expect(firstNoteText(row({ rebuyReason: "прислал скрин" }))).toEqual({ text: "не дошло: прислал скрин", empty: false });
    expect(firstNoteText(row({ note: "доплата" }))).toEqual({ text: "доплата", empty: false });
    expect(firstNoteText(row({ reason: "pinned" }))).toEqual({ text: "+ заметка", empty: true });
  });
});

describe("«Первым делом»: готовность пасса и копирование", () => {
  it("строка готовности", () => {
    expect(firstReadiness(row(), undefined)).toEqual({ text: "проверяю пасс…", tone: "muted" });
    expect(firstReadiness(row(), null)).toBeNull();
    expect(firstReadiness(row(), { isForSale: true, livePrice: 715 })?.tone).toBe("green");
    expect(firstReadiness(row(), { isForSale: false })?.text).toBe("⛔ пасс снят с продажи");
    expect(firstReadiness(row(), { isForSale: true, priceMismatch: true, livePrice: 800, expected: 715 })?.tone).toBe("orange");
    expect(firstReadiness(row({ gamepassIds: [] }), undefined)?.tone).toBe("red");
  });

  it("снятые с продажи и без пасса не попадают в пачку; повтор пасса не схлопывается", () => {
    const rows = [
      row({ id: "a", gamepassIds: ["1", "1"] }),
      row({ id: "b", gamepassIds: ["2"] }),
      row({ id: "c", gamepassIds: [] }),
    ];
    const result = firstCopyableIds(rows, { b: { isForSale: false } });
    expect(result).toEqual({ ids: ["1", "1"], orders: 1, noPass: 1, offSale: 1 });
    expect(firstCopyToast("первым делом", result)).toBe("⧉ первым делом: 2 ID из 1 заказов · снято с продажи: 1 · без пасса: 1");
    expect(firstCopyToast("x", firstCopyableIds([rows[1]], { b: { isForSale: false } }))).toBe("x: все пассы сняты с продажи");
  });

  it("сколько не влезло в блок", () => {
    expect(firstHiddenCount({ rows: [1, 2], total: 6 })).toBe(4);
    expect(firstHiddenCount({ rows: [1, 2], total: 2 })).toBe(0);
  });
});

describe("«Первым делом» v3 — фильтры и «Торопят» (01.11.2026)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const view = require("@/lib/first-in-line-view") as typeof import("@/lib/first-in-line-view");
  const r = (id: string, reason: "rebuy" | "rush" | "pinned" | "direct") => ({ id, reason });
  const rows = [r("a", "rebuy"), ...["b", "c", "d", "e", "f"].map((id) => r(id, "rush")), r("g", "pinned")];
  const totals = { rebuy: 1, rush: 7, pinned: 1, direct: 0 };

  it("порядок групп: 🔁 → 📣 → ⚡ → 💳", () => {
    expect(view.FIRST_GROUPS.map((g) => g.id)).toEqual(["rebuy", "rush", "pinned", "direct"]);
    expect(view.FIRST_GROUPS.find((g) => g.id === "rush")?.tone).toBe("purple");
  });

  it("«Все» — по три строки, остаток считается по серверному счётчику", () => {
    const groups = view.firstVisibleGroups(rows, "all", totals);
    const rush = groups.find((g) => g.group.id === "rush")!;
    expect(rush.rows.map((x) => x.id)).toEqual(["b", "c", "d"]);
    expect(rush.hidden).toBe(4);
  });

  it("фильтр группы — все загруженные строки только этой группы", () => {
    const groups = view.firstVisibleGroups(rows, "rush", totals);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(5);
    expect(groups[0].hidden).toBe(2);
  });

  it("на месте заметки у торопящего — цитата или как он обращался", () => {
    const rush = (quote: string | null, via: "status" | "support" | "chat") =>
      ({ count: 1, channels: ["TG" as const], lastAt: "2026-11-01T10:00:00Z", quote, via });
    expect(view.firstNoteText({ note: null, rebuyReason: null, rush: rush("где заказ?", "chat") })).toEqual({ text: "«где заказ?»", empty: false, quote: true });
    expect(view.firstNoteText({ note: null, rebuyReason: null, rush: rush(null, "status") }).text).toBe("нажимал «Статус»");
    expect(view.firstNoteText({ note: null, rebuyReason: null, rush: rush(null, "support") }).text).toBe("писал в поддержку");
    expect(view.firstNoteText({ note: "своя", rebuyReason: null, rush: rush("x", "chat") }).text).toBe("своя");
  });

  it("строка накала: число, каналы, давность", () => {
    const line = view.firstRushLine({ count: 3, channels: ["TG", "WB"], lastAt: "2026-11-01T10:00:00Z", quote: null, via: "chat" }, Date.parse("2026-11-01T12:00:00Z"));
    expect(line).toBe("📣 3× · TG, чат WB · 2 ч назад");
    expect(view.firstRushHeat(1)).toBe(1);
    expect(view.firstRushHeat(5)).toBe(3);
  });
});
