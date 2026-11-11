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

describe("метки диалогов ВК — правило", () => {
  it("имена укладываются в лимит ВК (20, без эмодзи) и цвета из разрешённого списка", () => {
    for (const { name, color } of Object.values(VK_LABELS)) {
      expect(name.length).toBeLessThanOrEqual(20);
      expect(name).toMatch(/^[\p{L}\p{N} ,]+$/u);
      expect(VK_TAG_COLORS).toContain(color);
    }
  });

  it("пасса нет: до 3 суток — «Ждём геймпасс», дольше — «Пропал без пасса»", () => {
    expect(labels(snap([order("AWAITING_GAMEPASS", { ageH: 5 })]))).toEqual(["pass"]);
    expect(labels(snap([order("AWAITING_GAMEPASS", { ageH: 100 })]))).toEqual(["stale"]);
    expect(labels(snap([order("AWAITING_GAMEPASS", { ageH: 5 }), order("AWAITING_GAMEPASS", { ageH: 100 })]))).toEqual(["pass"]);
  });

  it("пасс отклонён в коридоре — ждём новый; отмена прямого заказа — ничего", () => {
    expect(labels(snap([order("REJECTED", { ageH: 2 })]))).toEqual(["pass"]);
    expect(labels(snap([order("REJECTED", { ageH: 2, isDirectOrder: true })]))).toEqual([]);
  });

  it("пасс есть — «В очереди выкупа»; заморозка — отдельной меткой", () => {
    expect(labels(snap([order("PENDING")]))).toEqual(["queue"]);
    expect(labels(snap([order("IN_PROGRESS", { held: true })]))).toEqual(["held", "queue"]);
  });

  it("после выкупа: до 5 дней «Выкуплен, идут рб», 5–14 дней «Готово», дальше ничего", () => {
    expect(labels(snap([order("COMPLETED", { completedAt: daysAgo(1) })]))).toEqual(["bought"]);
    expect(labels(snap([order("COMPLETED", { completedAt: daysAgo(6) })]))).toEqual(["ready"]);
    expect(labels(snap([order("COMPLETED", { completedAt: daysAgo(15) })]))).toEqual([]);
    // Берётся последний выкуп, и открытый заказ важнее.
    expect(labels(snap([order("COMPLETED", { completedAt: daysAgo(9) }), order("COMPLETED", { completedAt: daysAgo(2) })]))).toEqual(["bought"]);
    expect(labels(snap([order("COMPLETED", { completedAt: daysAgo(1) }), order("AWAITING_PAYMENT", { ageH: 1 })]))).toEqual(["pay"]);
  });

  it("ждёт оплату — только свежие сутки (заказ или живая заявка)", () => {
    expect(labels(snap([order("AWAITING_PAYMENT", { ageH: 3, isDirectOrder: true })]))).toEqual(["pay"]);
    expect(labels(snap([order("PAYMENT_PENDING", { ageH: 30, isDirectOrder: true })]))).toEqual([]);
    expect(labels(snap([], { pendingIntentAt: hoursAgo(2) }))).toEqual(["pay"]);
  });

  it("«Нужен человек» — до ответа менеджера и не дольше 7 дней", () => {
    expect(labels(snap([], { humanSince: hoursAgo(2) }))).toEqual(["human"]);
    expect(labels(snap([], { humanSince: hoursAgo(2), managerReplied: true }))).toEqual([]);
    expect(labels(snap([], { humanSince: hoursAgo(80) }))).toEqual(["human"]);
    expect(labels(snap([], { humanSince: daysAgo(8) }))).toEqual([]);
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

describe("метки диалогов ВК — синхронизация", () => {
  function fakeApi(opts: { history?: Array<{ out: number; date: number; admin_author_id?: number }> } = {}) {
    const tags = [{ id: 1, name: "Не пришли рб" }];
    const calls: string[] = [];
    let historyCalls = 0;
    let next = 500;
    return {
      calls,
      tags,
      historyCalls: () => historyCalls,
      api: {
        call: async (method: string, p: Record<string, string | number>) => {
          if (method === "groups.getTagList") return tags.map((t) => ({ ...t }));
          if (method === "groups.tagAdd") { tags.push({ id: next++, name: String(p.tag_name), color: `#${p.tag_color}` } as never); return 1; }
          if (method === "groups.tagBind") {
            const name = tags.find((t) => t.id === p.tag_id)?.name;
            calls.push(`${p.act}:${p.user_id}:${name}`);
            return 1;
          }
          if (method === "messages.getHistory") { historyCalls++; return { items: opts.history ?? [] }; }
          throw new Error(`unexpected ${method}`);
        },
      },
    };
  }

  it("цвет занят ручной меткой — берёт свободный (ВК требует уникальный цвет)", async () => {
    const f = fakeApi();
    f.tags.push({ id: 2, name: "Не та цена", color: "#ffc107" } as never);
    const added: string[] = [];
    const api = { call: async (m: string, p: Record<string, string | number>) => {
      if (m === "groups.tagAdd") {
        const color = String(p.tag_color);
        if (added.includes(color) || color === "ffc107") throw Object.assign(new Error("color has been used already"), { code: 100 });
        added.push(color);
      }
      return f.api.call(m, p);
    } };
    const sync = new VkDialogLabelSync(api, 1, 0);
    const ids = await sync.ensureLabels();
    expect(ids.size).toBe(Object.keys(VK_LABELS).length);
    expect(added).not.toContain("ffc107");
    expect(new Set(added).size).toBe(added.length);
    // Замена не отнимает цвет у других наших меток.
    expect(added).toContain(VK_LABELS.ready.color);
    expect(added).toContain(VK_LABELS.pay.color);
  });

  it("создаёт недостающие метки и не трогает ручные", async () => {
    const f = fakeApi();
    const sync = new VkDialogLabelSync(f.api, 1, 0);
    await sync.ensureLabels();
    expect(f.tags.map((t) => t.name)).toEqual(["Не пришли рб", ...Object.values(VK_LABELS).map((l) => l.name)]);
    await sync.sync([snap([order("PENDING")])], NOW);
    expect(f.calls.some((c) => c.includes("Не пришли рб"))).toBe(false);
  });

  it("после рестарта сверяет всё, дальше шлёт только разницу и чистит ушедших", async () => {
    const f = fakeApi();
    const sync = new VkDialogLabelSync(f.api, 1, 0);
    const others = Object.keys(VK_LABELS).length - 1;

    await sync.sync([snap([order("AWAITING_GAMEPASS", { ageH: 2 })])], NOW);
    expect(f.calls.filter((c) => c.startsWith("bind"))).toEqual(["bind:100:Ждём геймпасс"]);
    expect(f.calls.filter((c) => c.startsWith("unbind"))).toHaveLength(others);

    f.calls.length = 0;
    await sync.sync([snap([order("AWAITING_GAMEPASS", { ageH: 2 })])], NOW);
    expect(f.calls).toEqual([]);

    await sync.sync([snap([order("PENDING")])], NOW);
    expect(f.calls).toEqual(["bind:100:В очереди выкупа", "unbind:100:Ждём геймпасс"]);

    f.calls.length = 0;
    await sync.sync([], NOW);
    expect(f.calls).toEqual(["unbind:100:В очереди выкупа"]);
  });

  it("«Нужен человек» снимается, когда в истории есть сообщение менеджера после обращения", async () => {
    const since = hoursAgo(3);
    const botOnly = fakeApi({ history: [{ out: 1, date: hoursAgo(1).getTime() / 1000 }] });
    const s1 = new VkDialogLabelSync(botOnly.api, 1, 0);
    await s1.sync([snap([], { humanSince: since })], NOW);
    expect(botOnly.calls).toContain("bind:100:Нужен человек");

    const manager = fakeApi({ history: [{ out: 1, date: hoursAgo(1).getTime() / 1000, admin_author_id: 7 }] });
    const s2 = new VkDialogLabelSync(manager.api, 1, 0);
    await s2.sync([snap([], { humanSince: since })], NOW);
    expect(manager.calls).not.toContain("bind:100:Нужен человек");
    // Ответ запомнен — второй раз историю не спрашиваем.
    await s2.sync([snap([], { humanSince: since })], NOW);
    expect(manager.historyCalls()).toBe(1);

    // Ответ менеджера ДО обращения не считается.
    const early = fakeApi({ history: [{ out: 1, date: hoursAgo(5).getTime() / 1000, admin_author_id: 7 }] });
    const s3 = new VkDialogLabelSync(early.api, 1, 0);
    await s3.sync([snap([], { humanSince: since })], NOW);
    expect(early.calls).toContain("bind:100:Нужен человек");
  });
});
