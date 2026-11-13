/**
 * Уведомления админам — в беседу по темам (14.11.2026). Беседы нет — личка,
 * тема выключена — тишина, кнопки web_app в беседе — ссылкой startapp.
 */

export {};

const ENV = process.env.ADMIN_IDS;
afterEach(() => {
  process.env.ADMIN_IDS = ENV;
  jest.resetModules();
});

async function load(row: { cursor: string | null; metadata: unknown } | null) {
  process.env.ADMIN_IDS = "111,222";
  const mod = await import("../admin-route");
  mod.registerAdminRouteDb({ wbSyncCursor: { findUnique: async () => row } });
  mod.resetAdminRouteCache();
  return mod;
}

const GROUP = { cursor: "-1001", metadata: { topics: { action: 10, feed: 11, direct: 12, reviews: 13, buyout: 14, system: 15, cases: 16 } } };

describe("тема по смыслу", () => {
  it("прямые, отзывы и система — всегда в своей теме", async () => {
    const { topicForNotice } = await load(null);
    expect(topicForNotice({ marker: "done", zone: "ПРЯМОЙ" })).toBe("direct");
    expect(topicForNotice({ marker: "action", zone: "ОТЗЫВ" })).toBe("reviews");
    expect(topicForNotice({ marker: "urgent", zone: "СИСТЕМА" })).toBe("system");
  });

  it("обращение покупателя — «Нужно действие», «застрял» без просьбы — тихо в ленту", async () => {
    const { topicForNotice } = await load(null);
    expect(topicForNotice({ marker: "action", zone: "ПОДДЕРЖКА" })).toBe("action");
    expect(topicForNotice({ marker: "waiting", zone: "ПОДДЕРЖКА" })).toBe("feed");
  });

  it("темы создаются в порядке владельца: особые заказы, потом прямые", async () => {
    const { ADMIN_TOPIC_KEYS } = await load(null);
    expect(ADMIN_TOPIC_KEYS.slice(0, 3)).toEqual(["cases", "direct", "action"]);
  });

  it("остальное: нужен человек → «Нужно действие», автоматика → тихая лента", async () => {
    const { topicForNotice } = await load(null);
    expect(topicForNotice({ marker: "urgent", zone: "DBS" })).toBe("action");
    expect(topicForNotice({ marker: "action", zone: "WB" })).toBe("action");
    expect(topicForNotice({ marker: "waiting", zone: "WB" })).toBe("feed");
    expect(topicForNotice({ marker: "done", zone: "ВЫКУП" })).toBe("feed");
  });
});

describe("получатели", () => {
  it("беседа есть — одно сообщение в нужную тему; тихое, если человеку делать нечего", async () => {
    const { adminTargets, adminTargetsForNotice } = await load(GROUP);
    expect(await adminTargets("direct", { loud: true })).toEqual([
      { key: "-1001#12", chatId: "-1001", extra: { message_thread_id: 12 }, group: true },
    ]);
    const [quiet] = await adminTargetsForNotice({ marker: "done", zone: "DBS" });
    expect(quiet.extra).toEqual({ message_thread_id: 11, disable_notification: true });
  });

  it("беседы нет — каждому админу в личку, как раньше", async () => {
    const { adminTargets } = await load(null);
    expect((await adminTargets("action")).map((t) => t.chatId)).toEqual(["111", "222"]);
  });

  it("темы нет в настройках — тоже личка: уведомление не теряется", async () => {
    const { adminTargets } = await load({ cursor: "-1001", metadata: { topics: {} } });
    expect((await adminTargets("cases")).map((t) => t.chatId)).toEqual(["111", "222"]);
  });

  it("выключенная тема — никому (так потом и уберём лишнее)", async () => {
    const { adminTargets } = await load({ ...GROUP, metadata: { ...GROUP.metadata, adminRouteOff: ["feed"] } });
    expect(await adminTargets("feed")).toEqual([]);
  });
});

describe("кнопки и ветки в беседе", () => {
  it("web_app → ссылка startapp с кодом заказа; callback-кнопки не трогаем", async () => {
    const { adminTargets, groupSafeMarkup } = await load(GROUP);
    const [t] = await adminTargets("buyout");
    const kb = groupSafeMarkup({
      inline_keyboard: [
        [{ text: "✅ ВЫКУПЛЕНО", callback_data: "admin_ok:1" }],
        [{ text: "📊 Дашборд", web_app: { url: "https://robloxbank.ru/twa?q=ZZF7T5B&k=secret" } }],
      ],
    }, t) as { inline_keyboard: Array<Array<Record<string, unknown>>> };
    expect(kb.inline_keyboard[0][0]).toEqual({ text: "✅ ВЫКУПЛЕНО", callback_data: "admin_ok:1" });
    expect(kb.inline_keyboard[1][0]).toEqual({ text: "📊 Дашборд", url: "https://t.me/RobloxBankBot?startapp=ZZF7T5B" });
  });

  it("в личке кнопки остаются как были", async () => {
    const { adminTargets, groupSafeMarkup } = await load(null);
    const [t] = await adminTargets("buyout");
    const markup = { inline_keyboard: [[{ text: "📊", web_app: { url: "https://robloxbank.ru/twa?q=X1" } }]] };
    expect(groupSafeMarkup(markup, t)).toBe(markup);
  });

  it("ответ на корень — только в той же теме", async () => {
    const { adminTargets, replyToRootFor } = await load(GROUP);
    const [feed] = await adminTargets("feed");
    const [action] = await adminTargets("action");
    const roots = { "-1001#11": 500 };
    expect(replyToRootFor(roots, feed)).toEqual({ reply_to_message_id: 500, allow_sending_without_reply: true });
    expect(replyToRootFor(roots, action)).toEqual({});
  });
});
