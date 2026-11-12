import { resolveWbOrderChat } from "../wb-order-chat";

/** 12.11.2026: у второго заказа корзины не было своего чата WB — выдача
 * молча выходила, покупательница осталась без кода. */
function fakeDb(row: { chatId: string; replySignEncrypted: string | null } | null) {
  const calls: unknown[] = [];
  return {
    calls,
    db: { wbBuyerChat: { findFirst: async (args: unknown) => { calls.push(args); return row; } } } as never,
  };
}

describe("resolveWbOrderChat", () => {
  const base = { id: "o2", orderUid: "r55e", isTest: false };

  it("prefers the order's own chat and does not query siblings", async () => {
    const { db, calls } = fakeDb({ chatId: "sib", replySignEncrypted: "S" });
    const chat = await resolveWbOrderChat(db, { ...base, chats: [{ chatId: "own", replySignEncrypted: "O" }] });
    expect(chat).toEqual({ chatId: "own", replySignEncrypted: "O", shared: false });
    expect(calls).toHaveLength(0);
  });

  it("falls back to the basket chat when the order has none", async () => {
    const { db, calls } = fakeDb({ chatId: "sib", replySignEncrypted: "S" });
    const chat = await resolveWbOrderChat(db, { ...base, chats: [] });
    expect(chat).toEqual({ chatId: "sib", replySignEncrypted: "S", shared: true });
    expect(JSON.stringify(calls[0])).toContain('"orderUid":"r55e"');
    expect(JSON.stringify(calls[0])).toContain('"not":"o2"');
  });

  it("stays silent for a single order without orderUid or without any usable chat", async () => {
    expect(await resolveWbOrderChat(fakeDb({ chatId: "x", replySignEncrypted: "S" }).db, { ...base, orderUid: null })).toBeNull();
    expect(await resolveWbOrderChat(fakeDb(null).db, base)).toBeNull();
    expect(await resolveWbOrderChat(fakeDb({ chatId: "x", replySignEncrypted: null }).db, base)).toBeNull();
  });
});
