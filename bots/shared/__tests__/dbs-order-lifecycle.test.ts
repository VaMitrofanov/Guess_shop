export {};

/**
 * Живая карточка ведёт заказ ЦЕЛИКОМ, а не до гейта.
 *
 * 05.09.2026, разбор по заказу NGS22UR. Карточка DBS доводила заказ до
 * «доставка закрыта, гейт отправлен · покупатель активирует код в боте» и на
 * этом застывала навсегда. Всё, что дальше — вход покупателя, полученная
 * ссылка, выкуп, — приходило отдельными сообщениями, а личность покупателя
 * сайт вообще слал голым куском («🆕 Новый пользователь / 👤 Имя / 🆔 VK ID»)
 * без кода, без номера WB и мимо ветки.
 *
 * Здесь закреплено, что делает заказ одним делом:
 *   1. личность покупателя — строка В карточке;
 *   2. после активации заголовок и таймлайн ведёт сам заказ на выкуп;
 *   3. состояние выкупа ВЫВОДИТСЯ из заказа, а не собирается из событий —
 *      статус меняют пять разных путей, и события с ними разошлись бы.
 */

const tgSend = jest.fn();
const tgEdit = jest.fn();

jest.mock("../notify", () => ({
  tgSend: (...args: unknown[]) => tgSend(...args),
  tgEdit: (...args: unknown[]) => tgEdit(...args),
  tgDelete: jest.fn(),
  tgMessageId: (sent: { result?: { message_id?: number } } | null) =>
    (typeof sent?.result?.message_id === "number" ? sent.result.message_id : null),
  escapeHtml: (s: string) => s,
}));

type Thread = typeof import("../wb-dbs-thread");
type AdminNotify = typeof import("../wb-delivery-admin-notify");
let refreshDbsCard: Thread["refreshDbsCard"];
let renderDbsCard: AdminNotify["renderDbsCard"];

beforeAll(async () => {
  process.env.ADMIN_IDS = "85137352";
  ({ refreshDbsCard } = await import("../wb-dbs-thread"));
  ({ renderDbsCard } = await import("../wb-delivery-admin-notify"));
});

beforeEach(() => {
  tgSend.mockReset();
  tgEdit.mockReset();
  tgSend.mockResolvedValue({ ok: true, result: { message_id: 2902 } });
  tgEdit.mockResolvedValue(true);
});

const at = (hhmm: string) => new Date(`2026-09-05T${hhmm}:00.000Z`);

/** Заказ доставки в состоянии «гейт отправлен, доставка закрыта». */
function deliveryRow(events: { type: string; payload: unknown; createdAt: Date }[]) {
  return {
    id: "mp1",
    wbOrderId: "5674129925",
    buyerName: "Марина",
    denominationSnapshot: 500,
    finalPriceKopecks: 47100,
    priceKopecks: 47100,
    isTest: false,
    cancelledAt: null,
    completedAt: at("04:17"),
    lastErrorCode: null,
    gateState: "SENT",
    chatState: "CODE_RECEIVED",
    supplierStatus: "receive",
    wbCreatedAt: at("04:02"),
    firstSeenAt: at("04:02"),
    adminCardMessages: { "85137352": 2902 },
    adminCardHash: null,
    wbCode: { code: "NGS22UR" },
    deliverySecret: null,
    events,
  };
}

/** Минимальная база: ровно те вызовы, которые делает карточка. */
function fakeDb(delivery: ReturnType<typeof deliveryRow>, buyout: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  return {
    updates,
    db: {
      wbMarketplaceOrder: {
        findUnique: async () => delivery,
        findFirst: async () => ({ id: delivery.id }),
        update: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return delivery; },
      },
      wbOrder: { findUnique: async () => buyout },
      wbMarketplaceEvent: { upsert: async () => ({}) },
    } as never,
  };
}

/** Текст карточки, который ушёл в Telegram. */
const sentText = (): string => (tgEdit.mock.calls[0]?.[2] ?? tgSend.mock.calls[0]?.[1]) as string;

describe("Карточка ведёт заказ после активации кода", () => {
  const signedIn = [{
    type: "BUYER_SIGNED_IN",
    createdAt: at("04:22"),
    payload: { channel: "VK", display: "Марина Б.", url: "https://vk.com/id266331926", isNew: true },
  }];

  it("покупатель назван в самой карточке, а не отдельным сообщением", async () => {
    const { db } = fakeDb(deliveryRow(signedIn), {
      status: "AWAITING_GAMEPASS", heldAt: null, heldReason: null,
      gamepassUrl: null, pendingAt: null, completedAt: null, splitGamepasses: [],
    });
    await refreshDbsCard(db, "mp1");
    const text = sentText();
    expect(text).toContain("Марина Б.");
    expect(text).toContain("https://vk.com/id266331926");
    expect(text).toContain("новый клиент");
  });

  it("после активации заголовок ведёт заказ на выкуп, а не доставку", async () => {
    const { db } = fakeDb(deliveryRow(signedIn), {
      status: "AWAITING_GAMEPASS", heldAt: null, heldReason: null,
      gamepassUrl: null, pendingAt: null, completedAt: null, splitGamepasses: [],
    });
    await refreshDbsCard(db, "mp1");
    expect(sentText()).toContain("код активирован — ждём геймпасс");
  });

  it("полученная ссылка и выкуп становятся шагами той же карточки", async () => {
    const { db } = fakeDb(deliveryRow(signedIn), {
      status: "COMPLETED", heldAt: null, heldReason: null,
      gamepassUrl: "https://www.roblox.com/game-pass/1966753478",
      pendingAt: at("06:47"), completedAt: at("07:10"), splitGamepasses: [],
    });
    await refreshDbsCard(db, "mp1");
    const text = sentText();
    expect(text).toContain("выкуплен");
    expect(text).toContain("ссылка получена — в очереди на выкуп");
  });

  it("заморозка перебивает статус: карточка не зовёт выкупать замороженный заказ", async () => {
    const { db } = fakeDb(deliveryRow(signedIn), {
      status: "PENDING", heldAt: at("06:00"), heldReason: "спор на WB",
      gamepassUrl: "https://www.roblox.com/game-pass/1", pendingAt: at("05:00"),
      completedAt: null, splitGamepasses: [],
    });
    await refreshDbsCard(db, "mp1");
    const text = sentText();
    expect(text).toContain("заморожен — не выкупать");
    expect(text).toContain("спор на WB");
    expect(text).not.toContain("нажать «ВЫКУПЛЕНО»");
  });

  it("без заказа на выкуп карточка остаётся прежней", async () => {
    const { db } = fakeDb(deliveryRow([]), null);
    await refreshDbsCard(db, "mp1");
    expect(sentText()).toContain("доставка закрыта, гейт отправлен");
  });
});

describe("renderDbsCard", () => {
  const base = {
    wbOrderId: "5674129925",
    buyerName: "Марина",
    denomination: 500,
    priceKopecks: 47100,
    activationCode: "NGS22UR",
    marker: "done" as const,
    title: "выкуплен",
    next: null,
    timeline: ["14:22  вошёл на сайт (VK)"],
  };

  it("без личности покупателя лишней строки не появляется", () => {
    expect(renderDbsCard({ ...base, buyer: null })).not.toContain("👤");
  });

  it("повторный клиент не помечается новым", () => {
    const text = renderDbsCard({
      ...base,
      buyer: { display: "Марина Б.", url: null, channel: "VK", isNew: false },
    });
    expect(text).toContain("👤 Марина Б.");
    expect(text).not.toContain("новый клиент");
  });
});
