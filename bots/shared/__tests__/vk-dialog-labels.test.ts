import {
  VK_LABELS,
  VK_TAG_COLORS,
  VkDialogLabelSync,
  desiredVkLabels,
  needsHuman,
  type VkLabelOrder,
  type VkLabelSnapshot,
  type VkSupportRequest,
} from "../vk-dialog-labels";

const NOW = new Date("2026-11-11T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const daysAgo = (d: number) => hoursAgo(d * 24);

function order(status: string, opts: Partial<VkLabelOrder> & { ageH?: number } = {}): VkLabelOrder {
  const at = hoursAgo(opts.ageH ?? 1);
  return { status, isDirectOrder: false, createdAt: at, updatedAt: at, completedAt: null, held: false, ...opts };
}
function snap(orders: VkLabelOrder[], extra: Partial<VkLabelSnapshot> = {}): VkLabelSnapshot {
  return { vkId: "100", pendingIntentAt: null, humanSince: null, orders, ...extra };
}
const labels = (s: VkLabelSnapshot) => [...desiredVkLabels(s, NOW)].sort();
const HISTORY = new Set(["regular", "once", "abandoned", "fresh"]);
/** Только стадии и флаги — без метки истории, которая есть всегда. */
const stages = (s: VkLabelSnapshot) => labels(s).filter((k) => !HISTORY.has(k));

describe("метки диалогов ВК — правило", () => {
  it("имена укладываются в лимит ВК (20, без эмодзи) и цвета из разрешённого списка", () => {
    for (const { name, color } of Object.values(VK_LABELS)) {
      expect(name.length).toBeLessThanOrEqual(20);
      expect(name).toMatch(/^[\p{L}\p{N} ,]+$/u);
      expect(VK_TAG_COLORS).toContain(color);
    }
  });

  it("пасса нет: до 3 суток — «Ждём геймпасс», дольше — «Пропал без пасса»", () => {
    expect(stages(snap([order("AWAITING_GAMEPASS", { ageH: 5 })]))).toEqual(["pass"]);
    expect(stages(snap([order("AWAITING_GAMEPASS", { ageH: 100 })]))).toEqual(["stale"]);
    expect(stages(snap([order("AWAITING_GAMEPASS", { ageH: 5 }), order("AWAITING_GAMEPASS", { ageH: 100 })]))).toEqual(["pass"]);
  });

  it("пасс отклонён в коридоре — ждём новый; отмена прямого заказа — ничего", () => {
    expect(stages(snap([order("REJECTED", { ageH: 2 })]))).toEqual(["pass"]);
    expect(stages(snap([order("REJECTED", { ageH: 2, isDirectOrder: true })]))).toEqual([]);
  });

  it("пасс есть — «В очереди выкупа»; заморозка — отдельной меткой", () => {
    expect(stages(snap([order("PENDING")]))).toEqual(["queue"]);
    expect(stages(snap([order("IN_PROGRESS", { held: true })]))).toEqual(["held", "queue"]);
  });

  it("после выкупа: до 5 дней «Выкуплен, идут рб», 5–14 дней «Готово», дальше ничего", () => {
    expect(stages(snap([order("COMPLETED", { completedAt: daysAgo(1) })]))).toEqual(["bought"]);
    expect(stages(snap([order("COMPLETED", { completedAt: daysAgo(6) })]))).toEqual(["ready"]);
    expect(stages(snap([order("COMPLETED", { completedAt: daysAgo(15) })]))).toEqual([]);
    // Берётся последний выкуп, и открытый заказ важнее.
    expect(stages(snap([order("COMPLETED", { completedAt: daysAgo(9) }), order("COMPLETED", { completedAt: daysAgo(2) })]))).toEqual(["bought"]);
    expect(stages(snap([order("COMPLETED", { completedAt: daysAgo(1) }), order("AWAITING_PAYMENT", { ageH: 1 })]))).toEqual(["pay"]);
  });

  it("ждёт оплату — только свежие сутки (заказ или живая заявка)", () => {
    expect(stages(snap([order("AWAITING_PAYMENT", { ageH: 3, isDirectOrder: true })]))).toEqual(["pay"]);
    expect(stages(snap([order("PAYMENT_PENDING", { ageH: 30, isDirectOrder: true })]))).toEqual([]);
    expect(stages(snap([], { pendingIntentAt: hoursAgo(2) }))).toEqual(["pay"]);
  });

  it("«Нужен человек» — до ответа менеджера и не дольше 7 дней", () => {
    expect(stages(snap([], { humanSince: hoursAgo(2) }))).toEqual(["human"]);
    expect(stages(snap([], { humanSince: hoursAgo(2), managerReplied: true }))).toEqual([]);
    expect(stages(snap([], { humanSince: hoursAgo(80) }))).toEqual(["human"]);
    expect(stages(snap([], { humanSince: daysAgo(8) }))).toEqual([]);
  });
});

describe("«Нужен человек» — только настоящие случаи (реальные обращения 10–11.2026)", () => {
  const req = (text: string | null, o: Partial<VkSupportRequest> = {}): VkSupportRequest => ({
    at: NOW, text, contextKey: "status", robux: false, ocr: null, ocrPending: null,
    orderStatus: "PENDING", orderCompletedAt: null, ...o,
  });
  const doneDaysAgo = (d: number) => ({ orderStatus: "COMPLETED", orderCompletedAt: daysAgo(d) });

  it.each([
    ["Отменить заказ", { contextKey: "no_place", orderStatus: "REJECTED" }],
    ["Какую причину на возраст в ВБ выбирать?", { contextKey: "no_place", orderStatus: "REJECTED" }],
    ["Компьютера нет, как сделать?", { contextKey: "no_place", orderStatus: "AWAITING_GAMEPASS" }],
    ["Нет компьютера", { contextKey: "no_place", orderStatus: "AWAITING_GAMEPASS" }],
    ["Здравствуйте, заказывали роблоксы, они до сих пор в статусе pending, прошло уже 8 дней", doneDaysAgo(8)],
    ["Жду четырнадцать дней где они?", doneDaysAgo(12)],
    ["Пароль не помню", doneDaysAgo(8)],
    ["У меня в самом начале диалога был неправильный ник, не было 1 буквы", {}],
  ] as Array<[string, Partial<VkSupportRequest>]>)("нужен: %s", (text, o) => {
    expect(needsHuman(req(text, o))).toBe(true);
  });

  it.each([
    ["пустое — просто нажал кнопку", req(null, doneDaysAgo(8))],
    ["«когда придут» до выкупа — это очередь", req("Когда прийдут робуксы?", { robux: true })],
    ["«почему так долго» до выкупа", req("Почему так долго выкупают")],
    ["«не пришли» в окне ожидания Roblox", req("Не пришли робаксы, что делать?", { robux: true, ...doneDaysAgo(1) })],
    ["скрин, где робуксы «в ожидании» видны", req("Почему оно не горит", {
      contextKey: "robux_low_pending", robux: true, ocr: "ok", ocrPending: 500, ...doneDaysAgo(1),
    })],
    ["тот же вопрос по скрину в окне ожидания, даже если OCR не прочёл", req("Почему оно не горит", {
      contextKey: "robux_low_pending", robux: true, ...doneDaysAgo(2),
    })],
    ["«спасибо»", req("Спасибо, всё пришло", { contextKey: "menu", ...doneDaysAgo(6) })],
  ])("не нужен: %s", (_name, r) => {
    expect(needsHuman(r)).toBe(false);
  });
});

describe("метки истории — у каждого диалога хоть одна метка", () => {
  it("нет ничего открытого — история клиента", () => {
    expect(labels(snap([], { completedCount: 3 }))).toEqual(["regular"]);
    expect(labels(snap([], { completedCount: 1 }))).toEqual(["once"]);
    expect(labels(snap([order("REJECTED", { ageH: 24 * 20, isDirectOrder: true })], { everOrdered: true }))).toEqual(["abandoned"]);
    expect(labels(snap([]))).toEqual(["fresh"]);
  });
  it("история не ставится поверх текущей стадии; «Нужен человек» с ней совместим", () => {
    expect(labels(snap([order("PENDING")], { completedCount: 3 }))).toEqual(["queue"]);
    expect(labels(snap([], { humanSince: hoursAgo(1) }))).toEqual(["fresh", "human"]);
  });
});

describe("метки диалогов ВК — синхронизация", () => {
  /** Фейковый ВК: метки сообщества, метки диалогов, история сообщений. */
  function fakeVk(opts: {
    dialogs?: Record<string, number[]>;
    history?: Array<{ out: number; date: number; admin_author_id?: number }>;
    tags?: Array<{ id: number; name: string; color: string }>;
  } = {}) {
    const tags = opts.tags ?? [{ id: 1, name: "Не пришли рб", color: "#ffc107" }];
    const dialogs = new Map(Object.entries(opts.dialogs ?? { "100": [] }).map(([k, v]) => [k, new Set(v)]));
    const calls: string[] = [];
    let historyCalls = 0;
    let next = 500;
    const nameOf = (id: unknown) => tags.find((t) => t.id === Number(id))?.name;
    return {
      calls, tags, dialogs,
      historyCalls: () => historyCalls,
      api: {
        call: async (method: string, p: Record<string, string | number>) => {
          if (method === "groups.getTagList") return tags.map((t) => ({ ...t }));
          if (method === "groups.tagAdd") {
            if (tags.some((t) => t.color === `#${p.tag_color}`)) throw Object.assign(new Error("color has been used already"), { code: 100 });
            tags.push({ id: next++, name: String(p.tag_name), color: `#${p.tag_color}` });
            return 1;
          }
          if (method === "messages.getConversations") {
            const all = [...dialogs.entries()];
            const page = all.slice(Number(p.offset), Number(p.offset) + Number(p.count));
            return { count: all.length, items: page.map(([id, t]) => ({ conversation: { peer: { id: Number(id), type: "user" }, tags: [...t] } })) };
          }
          if (method === "groups.tagBind") {
            const set = dialogs.get(String(p.user_id)) ?? new Set<number>();
            if (p.act === "bind") set.add(Number(p.tag_id)); else set.delete(Number(p.tag_id));
            dialogs.set(String(p.user_id), set);
            calls.push(`${p.act}:${p.user_id}:${nameOf(p.tag_id)}`);
            return 1;
          }
          if (method === "messages.getHistory") { historyCalls++; return { items: opts.history ?? [] }; }
          throw new Error(`unexpected ${method}`);
        },
      },
    };
  }
  const loader = (snaps: VkLabelSnapshot[]) => async () => snaps;

  it("цвет занят ручной меткой — берёт свободный, не отнимая цвет у своих", async () => {
    const f = fakeVk();
    const sync = new VkDialogLabelSync(f.api, 1, 0);
    const ids = await sync.ensureLabels();
    expect(ids.size).toBe(Object.keys(VK_LABELS).length);
    const colors = f.tags.map((t) => t.color);
    expect(new Set(colors).size).toBe(colors.length);
    expect(colors).toContain(`#${VK_LABELS.ready.color}`);
    expect(colors).toContain(`#${VK_LABELS.pay.color}`);
  });

  it("сверяется с метками, которые реально стоят: шлёт только разницу, ручные не трогает", async () => {
    const f = fakeVk({ dialogs: { "100": [1], "200": [] } });
    const sync = new VkDialogLabelSync(f.api, 1, 0);
    const pass = snap([order("AWAITING_GAMEPASS", { ageH: 2 })]);
    await sync.run(loader([pass]), NOW);
    // 100 — «Ждём геймпасс», 200 нет в базе — «Новый клиент». Ручная метка 1 на месте.
    expect(f.calls.sort()).toEqual(["bind:100:Ждём геймпасс", "bind:200:Новый клиент"]);
    expect(f.dialogs.get("100")!.has(1)).toBe(true);

    f.calls.length = 0;
    await sync.run(loader([pass]), NOW);
    expect(f.calls).toEqual([]); // всё уже стоит — ни одного вызова

    await sync.run(loader([snap([order("PENDING")])]), NOW);
    expect(f.calls).toEqual(["bind:100:В очереди выкупа", "unbind:100:Ждём геймпасс"]);
  });

  it("«Нужен человек» снимается, когда в истории есть сообщение менеджера после обращения", async () => {
    const since = hoursAgo(3);
    const botOnly = fakeVk({ history: [{ out: 1, date: hoursAgo(1).getTime() / 1000 }] });
    await new VkDialogLabelSync(botOnly.api, 1, 0).run(loader([snap([], { humanSince: since })]), NOW);
    expect(botOnly.calls).toContain("bind:100:Нужен человек");

    const manager = fakeVk({ history: [{ out: 1, date: hoursAgo(1).getTime() / 1000, admin_author_id: 7 }] });
    const s2 = new VkDialogLabelSync(manager.api, 1, 0);
    await s2.run(loader([snap([], { humanSince: since })]), NOW);
    expect(manager.calls).not.toContain("bind:100:Нужен человек");
    await s2.run(loader([snap([], { humanSince: since })]), NOW);
    expect(manager.historyCalls()).toBe(1); // ответ запомнен

    const early = fakeVk({ history: [{ out: 1, date: hoursAgo(5).getTime() / 1000, admin_author_id: 7 }] });
    await new VkDialogLabelSync(early.api, 1, 0).run(loader([snap([], { humanSince: since })]), NOW);
    expect(early.calls).toContain("bind:100:Нужен человек");
  });

  it("листает все страницы диалогов", async () => {
    const dialogs: Record<string, number[]> = {};
    for (let i = 1; i <= 450; i++) dialogs[String(i)] = [];
    const f = fakeVk({ dialogs });
    const res = await new VkDialogLabelSync(f.api, 1, 0).run(loader([]), NOW);
    expect(res.dialogs).toBe(450);
    expect(res.bound).toBe(450); // все — «Новый клиент»
  });
});
