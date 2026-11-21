/**
 * F1 (ultra-review 28.07): `createCanonicalWebOrder` эмитил топик
 * `web.order.created`, а воркер о нём не знал. Каждый заказ с сайта уходил в
 * 8 попыток по ~2 часа и умирал с тревогой `🚨 OUTBOX DEAD-LETTER` админам —
 * на проде так погибли 4 сообщения из 4.
 *
 * Здесь две вещи: поведение новой ветки и контракт «эмитируемые топики ⊆
 * обрабатываемые», который не даст разойтись снова.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";

const sent: { chatId: string; text: string }[] = [];
const customerMessages: string[] = [];

jest.mock("../notify", () => ({
  tgSend: jest.fn(async (chatId: string, text: string) => {
    sent.push({ chatId, text });
    return { ok: true };
  }),
  vkSend: jest.fn(async () => ({ ok: true })),
  stripHtml: (s: string) => s,
  escapeHtml: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
}));

const cards: Record<string, unknown>[] = [];
jest.mock("../admin-route", () => ({
  adminTargets: jest.fn(async () => (process.env.ADMIN_IDS ?? "").split(",").filter(Boolean)
    .map((id) => ({ key: id, chatId: id, extra: {}, group: false }))),
}));
jest.mock("../admin", () => ({
  sendAdminOrderCard: jest.fn(async (card: Record<string, unknown>) => { cards.push(card); return 1; }),
}));
jest.mock("../order-loyalty", () => ({ countPreviousOrders: jest.fn(async () => 0) }));

type OrderRow = Record<string, unknown>;
const state: { order: OrderRow | null } = { order: null };

jest.mock("../db", () => ({
  db: {
    wbOrder: { findUnique: async () => state.order },
  },
}));

import { dispatch, HANDLED_TOPICS, UnsupportedTopicError } from "../payment-outbox";

const bot = {
  telegram: {
    sendMessage: jest.fn(async (_chatId: string, text: string) => {
      customerMessages.push(text);
    }),
  },
};

const ORDER_ID = "order-1";

function baseOrder(overrides: OrderRow = {}): OrderRow {
  return {
    id: ORDER_ID,
    publicOrderId: "WEB-DEADBEEF",
    wbCode: "WEB-DEADBEEF",
    status: "AWAITING_PAYMENT",
    amount: 1000,
    paymentAmountKopecks: 160_00,
    robloxUsername: "TestNick",
    user: { tgId: "555", vkId: null, name: "Клиент", username: null },
    userId: "u1",
    platform: "VK",
    orderSource: "DIRECT",
    gamepassUrl: null,
    createdAt: new Date(),
    splitGamepasses: [],
    paymentAttempts: [{ amountKopecks: 160_00, refundedAmountKopecks: 0, status: "PENDING" }],
    ...overrides,
  };
}

beforeEach(() => {
  sent.length = 0;
  cards.length = 0;
  customerMessages.length = 0;
  bot.telegram.sendMessage.mockClear();
  process.env.ADMIN_IDS = "111,222";
  state.order = baseOrder();
});

describe("web.order.created", () => {
  it("шлёт админам карточку нового заказа и НЕ пишет клиенту", async () => {
    await dispatch({ topic: "web.order.created", payload: { orderId: ORDER_ID } }, bot);

    expect(sent.map((s) => s.chatId)).toEqual(["111", "222"]);
    expect(sent[0].text).toContain("ПРЯМОЙ · заказ с сайта — ждёт оплаты");
    expect(sent[0].text).toContain("WEB-DEADBEEF");
    expect(sent[0].text).toContain("160.00 ₽");
    expect(sent[0].text).toMatch(/1\s?000 R\$/);
    expect(sent[0].text).toContain("TestNick");
    // Клиент в этот момент на странице оплаты — сообщение только помешает.
    expect(customerMessages).toHaveLength(0);
  });

  it("не падает и ничего не шлёт, если заказ уже уехал дальше", async () => {
    // Сообщение могло пролежать в очереди дольше, чем заказ оставался неоплаченным.
    state.order = baseOrder({ status: "PENDING" });

    await expect(
      dispatch({ topic: "web.order.created", payload: { orderId: ORDER_ID } }, bot),
    ).resolves.toBeUndefined();

    expect(sent).toHaveLength(0);
    expect(customerMessages).toHaveLength(0);
  });

  it("экранирует HTML в нике, чтобы карточка не разваливалась", async () => {
    state.order = baseOrder({ robloxUsername: "<b>hax</b>" });

    await dispatch({ topic: "web.order.created", payload: { orderId: ORDER_ID } }, bot);

    expect(sent[0].text).toContain("&lt;b&gt;hax&lt;/b&gt;");
  });
});

describe("неизвестный топик", () => {
  it("бросает UnsupportedTopicError до обращения к БД", async () => {
    await expect(
      dispatch({ topic: "totally.unknown", payload: { orderId: ORDER_ID } }, bot),
    ).rejects.toBeInstanceOf(UnsupportedTopicError);
    expect(sent).toHaveLength(0);
  });
});

describe("payment.confirmed reconciliation", () => {
  it("помечает ручной перевод как оплату из ручного перевода", async () => {
    state.order = baseOrder({
      status: "PENDING",
      orderSource: "DIRECT",
      paymentAttempts: [{ provider: "MANUAL_TRANSFER", amountKopecks: 160_00, refundedAmountKopecks: 0, status: "CONFIRMED" }],
    });

    await dispatch({ topic: "payment.confirmed", payload: { orderId: ORDER_ID } }, bot);

    expect(sent[0].text).toContain("оплачен — ждём геймпасс");
    expect(sent[0].text).toContain("Оплачено переводом");
    expect(customerMessages).toHaveLength(1);
  });

  it("не обещает выкуп и поднимает тревогу, если льготы не удалось зарезервировать", async () => {
    state.order = baseOrder({ status: "ERROR" });

    await dispatch({
      topic: "payment.confirmed",
      payload: { orderId: ORDER_ID, needsReconciliation: true },
    }, bot);

    expect(sent[0].text).toContain("нужна сверка льгот");
    expect(sent[0].text).toContain("не выкупать");
    expect(customerMessages[0]).toContain("вручную сверяем");
    expect(customerMessages[0]).not.toContain("появился в работе");
  });
});

describe("payment.confirmed → карточка выкупа в «Прямые заказы» (21.11.2026)", () => {
  it("оплаченный картой заказ с пассом даёт обычную карточку выкупа со строкой оплаты", async () => {
    state.order = baseOrder({
      status: "PENDING",
      publicOrderId: "BOT-4B1B86E3B3162245C8A9",
      wbCode: "BOT-4B1B86E3B3162245C8A9",
      gamepassUrl: "https://www.roblox.com/game-pass/2040129371",
      robloxUsername: "Saharok3506",
      user: { tgId: null, vkId: "278949891", name: "Покупатель", username: null },
      paymentAttempts: [{ provider: "TBANK", amountKopecks: 870_00, refundedAmountKopecks: 0, status: "CONFIRMED" }],
    });

    await dispatch({ topic: "payment.confirmed", payload: { orderId: ORDER_ID } }, bot);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      orderSource: "DIRECT", amount: 1000, title: "оплачен — к выкупу", creatorName: "Saharok3506",
    });
    expect(String(cards[0].paidLine)).toContain("картой: <b>870.00 ₽</b>");
    // Голого текста в личку больше нет — только карточка.
    expect(sent).toHaveLength(0);
  });
});

describe("контракт: эмитируемые топики ⊆ обрабатываемые", () => {
  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("каждый топик, который приложение кладёт в outbox, известен воркеру", () => {
    const root = resolve(__dirname, "../../..");
    const files = [...sourceFiles(join(root, "src")), ...sourceFiles(join(root, "bots"))];

    const emitted = new Set<string>();
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      // Нас интересуют только блоки создания outbox-сообщения. Топик может быть
      // и литералом, и тернарником (`topic: x === "CONFIRMED" ? "a" : "b"`),
      // поэтому разбирать выражение бессмысленно — забираем все строки, похожие
      // на имя топика (строчные слова через точку), из области создания.
      for (const block of text.split("outboxMessage.create").slice(1)) {
        const head = block.slice(0, 400);
        if (!head.includes("topic:")) continue;
        for (const match of head.matchAll(/"([a-z][a-z0-9]*(?:\.[a-z0-9]+)+)"/g)) {
          emitted.add(match[1]);
        }
      }
    }

    // Защита от «тест ничего не нашёл и поэтому зелёный»: все три известных
    // топика обязаны быть обнаружены, иначе сломался сам детектор.
    expect([...emitted].sort()).toEqual(
      expect.arrayContaining(["bot.order.created", "payment.confirmed", "payment.refund.recorded", "web.order.created"]),
    );

    const unhandled = [...emitted].filter((topic) => !HANDLED_TOPICS.has(topic));
    expect(unhandled).toEqual([]);
  });
});
