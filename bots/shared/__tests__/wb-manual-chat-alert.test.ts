import { collectManualChatAlerts, manualChatDecision, MANUAL_CHAT_ALERTED } from "../wb-manual-chat-alert";

const t0 = new Date("2026-11-21T09:59:09Z").getTime();
const at = (s: number) => new Date(t0 + s * 1000);

describe("800code: покупатель ждёт в чате", () => {
  const lilia = [
    { sender: "client", sentAt: at(0), textRedacted: "Здравствуйте" },
    { sender: "client", sentAt: at(6), textRedacted: "191 851" },
    { sender: "client", sentAt: at(17), textRedacted: "Это код доставки" },
  ];

  it("через минуту без ответа — один сигнал со всеми сообщениями", () => {
    expect(manualChatDecision(lilia, t0 + 30_000)).toBeNull();
    const d = manualChatDecision(lilia, t0 + 90_000);
    expect(d).toEqual({ firstAt: at(0), texts: ["Здравствуйте", "191 851", "Это код доставки"] });
  });

  it("ответили — сигнала нет", () => {
    expect(manualChatDecision([...lilia, { sender: "seller", sentAt: at(40), textRedacted: "Добрый день" }], t0 + 600_000)).toBe("answered");
  });

  it("служебная строка WB от client — не покупатель", () => {
    expect(manualChatDecision([{ sender: "client", sentAt: at(0), textRedacted: "Чат с покупателем по товару 1447864924" }], t0 + 600_000)).toBeNull();
  });

  it("помечает заказ событием и отдаёт живой код доставки", async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const findMany = jest.fn().mockResolvedValue([
      { id: "o1", wbOrderId: "6325347265", nmId: 1447864924, chatEvents: lilia,
        deliverySecret: { encryptedValue: "enc", consumedAt: null, expiresAt: new Date(t0 + 86_400_000) } },
      { id: "o2", wbOrderId: "2", nmId: 1447864924, deliverySecret: null,
        chatEvents: [...lilia, { sender: "seller", sentAt: at(30), textRedacted: "ок" }] },
    ]);
    const out = await collectManualChatAlerts({ wbMarketplaceOrder: { findMany }, wbMarketplaceEvent: { upsert } }, t0 + 120_000);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ orderId: "o1", deliveryCodeEncrypted: "enc" });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0][0].create).toMatchObject({ type: MANUAL_CHAT_ALERTED, payload: { answered: false } });
    expect(upsert.mock.calls[1][0].create.payload).toEqual({ answered: true });
    expect(findMany.mock.calls[0][0].where).toMatchObject({ denominationSnapshot: null, events: { none: { type: MANUAL_CHAT_ALERTED } } });
  });
});
