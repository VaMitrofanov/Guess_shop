/**
 * Алерт поддержки обязан отвечать на вопрос «а что с заказом?» сам.
 *
 * До 04.09.2026 он называл код, номинал и причину, по которой человек нажал
 * кнопку, — и на этом заканчивался. Владелец шёл искать заказ руками: открыть
 * дашборд, найти код, посмотреть статус, посчитать возраст. На «Заказ долго в
 * обработке» это три-четыре минуты до первого слова клиенту, каждый раз.
 *
 * Тесты держат ровно то, ради чего справка добавлена: статус, возраст, что
 * держит заказ, и то, что справка НИКОГДА не отменяет само сообщение.
 */
export {};

const tgSend = jest.fn();
const orderFindUnique = jest.fn();
const orderFindFirst = jest.fn();
const orderCount = jest.fn();
const userFindUnique = jest.fn();

jest.mock("../notify", () => ({
  tgSend: (...args: unknown[]) => tgSend(...args),
  tgSendPhoto: jest.fn(),
  escapeHtml: (s: string) => s,
}));
jest.mock("../db", () => ({
  db: {
    wbOrder: {
      findUnique: (...args: unknown[]) => orderFindUnique(...args),
      findFirst: (...args: unknown[]) => orderFindFirst(...args),
      count: (...args: unknown[]) => orderCount(...args),
    },
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
  },
}));
jest.mock("../wb-order-source", () => ({
  resolveWbOrderSource: async () => "WB",
  wbOrderSourceLabel: (platform: string) => platform,
}));
jest.mock("../twa-link", () => ({ twaLaunchUrl: () => "https://robloxbank.ru/twa" }));
jest.mock("../order-hold", () => ({ heldCustomerFor: async () => null }));

type Admin = typeof import("../admin");
let sendAdminSupportAlert: Admin["sendAdminSupportAlert"];

const DAY = 24 * 3600_000;

const order = (over: Record<string, unknown> = {}) => ({
  id: "cly000000000000000000001",
  wbCode: "VGAA3F2",
  amount: 500,
  status: "AWAITING_GAMEPASS",
  platform: "TG",
  orderSource: "WB",
  isDirectOrder: false,
  paidAt: null,
  gamepassId: null,
  gamepassUrl: null,
  robloxUsername: null,
  probableNick: null,
  remindersSent: 3,
  buyoutErrorCode: null,
  rejectionReason: null,
  adminNote: null,
  userId: "user-1",
  createdAt: new Date(Date.now() - 16 * DAY),
  pendingAt: null,
  completedAt: null,
  splitGamepasses: [],
  ...over,
});

/** Текст, ушедший первому админу. */
const sentText = (): string => String(tgSend.mock.calls[0]?.[1] ?? "");

beforeAll(async () => {
  process.env.ADMIN_IDS = "111,222";
  ({ sendAdminSupportAlert } = await import("../admin"));
});

beforeEach(() => {
  tgSend.mockReset();
  orderFindUnique.mockReset();
  orderFindFirst.mockReset();
  userFindUnique.mockReset();
  orderCount.mockReset().mockResolvedValue(4);
});

const call = () => sendAdminSupportAlert({
  platform: "TG",
  userDisplay: "@Narkosha_zaxvatit_mir",
  tgId: "12345",
  contextKey: "pending_long",
  wbCode: "VGAA3F2",
  denomination: 500,
});

describe("справка по заказу внутри алерта поддержки", () => {
  it("называет статус и возраст — их искали руками в первую очередь", async () => {
    orderFindUnique.mockResolvedValue(order());
    await call();

    const text = sentText();
    expect(text).toContain("📍 Причина: <b>Заказ долго в обработке</b>");
    expect(text).toContain("ждёт ссылку на геймпасс");
    expect(text).toContain("16 дней");
    // Причина — то, с чем пришёл человек; справка — то, что на самом деле.
    expect(text.indexOf("📍 Причина")).toBeLessThan(text.indexOf("📦 Заказ"));
  });

  it("на «ждёт ссылку» говорит, что бот уже отмолчал все напоминания", async () => {
    orderFindUnique.mockResolvedValue(order({ remindersSent: 3 }));
    await call();
    expect(sentText()).toContain("бот замолчал");
  });

  it("выкупленный заказ не выглядит как зависший", async () => {
    orderFindUnique.mockResolvedValue(order({
      status: "COMPLETED",
      completedAt: new Date(Date.now() - 2 * 3600_000),
    }));
    await call();

    const text = sentText();
    expect(text).toContain("выкуплен");
    expect(text).toContain("✅ Выкуплен");
  });

  it("у разбитого заказа видно, сколько частей закрыто", async () => {
    orderFindUnique.mockResolvedValue(order({
      status: "PENDING",
      pendingAt: new Date(Date.now() - 3600_000),
      splitGamepasses: [{ purchasedAt: new Date() }, { purchasedAt: null }, { purchasedAt: null }],
    }));
    await call();
    expect(sentText()).toContain("выкуплено 1 из 3");
  });

  it("ошибка выкупа названа человеческим языком, а не кодом", async () => {
    orderFindUnique.mockResolvedValue(order({ status: "ERROR", buyoutErrorCode: "REGIONAL_PRICE" }));
    await call();
    expect(sentText()).toContain("региональная цена");
  });

  it("повторный клиент виден числом заказов", async () => {
    orderFindUnique.mockResolvedValue(order());
    await call();
    expect(sentText()).toContain("4-й заказ");
  });

  it("без кода берёт последний тронутый заказ клиента", async () => {
    userFindUnique.mockResolvedValue({ id: "user-1" });
    orderFindFirst.mockResolvedValue(order({ wbCode: "ABCD123", amount: 1000 }));

    await sendAdminSupportAlert({
      platform: "TG", userDisplay: "@nick", tgId: "12345", contextKey: "general",
    });

    expect(orderFindUnique).not.toHaveBeenCalled();
    // Код найденного заказа поднимается в шапку — иначе она ссылалась бы в
    // пустоту, а справка под ней говорила о конкретном заказе.
    expect(sentText()).toContain("ABCD123");
  });
});

describe("справка не может отменить само сообщение", () => {
  it("упавший запрос к базе оставляет алерт на месте", async () => {
    orderFindUnique.mockRejectedValue(new Error("Neon недоступен"));
    await call();

    const text = sentText();
    expect(tgSend).toHaveBeenCalledTimes(2); // оба админа
    expect(text).toContain("📍 Причина: <b>Заказ долго в обработке</b>");
    expect(text).not.toContain("📦 Заказ:");
  });

  it("заказа нет в базе — алерт всё равно уходит", async () => {
    orderFindUnique.mockResolvedValue(null);
    userFindUnique.mockResolvedValue(null);
    await call();

    expect(tgSend).toHaveBeenCalledTimes(2);
    expect(sentText()).toContain("VGAA3F2");
  });
});
