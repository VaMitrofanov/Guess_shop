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
}));

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
    user: { tgId: "555", vkId: null, name: "Клиент" },
    paymentAttempts: [{ amountKopecks: 160_00, refundedAmountKopecks: 0, status: "PENDING" }],
    ...overrides,
  };
}

beforeEach(() => {
  sent.length = 0;
  customerMessages.length = 0;
  bot.telegram.sendMessage.mockClear();
  process.env.ADMIN_IDS = "111,222";
  state.order = baseOrder();
});

describe("web.order.created", () => {
  it("шлёт админам карточку нового заказа и НЕ пишет клиенту", async () => {
    await dispatch({ topic: "web.order.created", payload: { orderId: ORDER_ID } }, bot);

    expect(sent.map((s) => s.chatId)).toEqual(["111", "222"]);
    expect(sent[0].text).toContain("ЗАКАЗ С САЙТА СОЗДАН");
    expect(sent[0].text).toContain("WEB-DEADBEEF");
    expect(sent[0].text).toContain("160.00 ₽");
    expect(sent[0].text).toContain("1000 R$");
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
      expect.arrayContaining(["payment.confirmed", "payment.refund.recorded", "web.order.created"]),
    );

    const unhandled = [...emitted].filter((topic) => !HANDLED_TOPICS.has(topic));
    expect(unhandled).toEqual([]);
  });
});
