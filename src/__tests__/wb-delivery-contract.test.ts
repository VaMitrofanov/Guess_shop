import {
  deliveryWindow,
  wbBuyerName,
  wbClientOrderId,
  WbBulkMutationResponseSchema,
  WbChatEventsResponseSchema,
  WbChatsResponseSchema,
  WbDbsClientResponseSchema,
  WbDbsOrdersResponseSchema,
  WbStatusesResponseSchema,
} from "../../bots/shared/wb-delivery-contract";

describe("WB DBS tolerant API contracts", () => {
  it("normalizes successful status responses where WB returns errors=null", () => {
    expect(WbStatusesResponseSchema.parse({
      orders: [{ orderId: 123, supplierStatus: "new", wbStatus: "waiting", errors: null }],
    })).toEqual({
      orders: [{ orderId: "123", supplierStatus: "new", wbStatus: "waiting", errors: [] }],
    });
  });

  it("normalizes numeric and string order ids without dropping future fields", () => {
    const parsed = WbDbsOrdersResponseSchema.parse({
      orders: [{ id: 987654321, nmId: 123, rid: "rid-1", price: 149900, requiredMeta: ["imei"], future: true }],
      next: 0,
      trace: "safe-extra",
    });
    expect(parsed.orders[0].id).toBe("987654321");
    expect(parsed.orders[0].price).toBe(149900);
    expect(parsed.next).toBe("0");
  });

  it("accepts buyer chat directory and event pagination", () => {
    const chats = WbChatsResponseSchema.parse({ result: [{ chatID: "chat-1", replySign: "opaque", goodCard: { rid: "rid-1", nmID: 123 } }] });
    const events = WbChatEventsResponseSchema.parse({ result: { next: 42, events: [{ chatID: "chat-1", eventID: "event-1", sender: "client", message: { text: "123456" } }] } });
    expect(chats.result[0].goodCard?.rid).toBe("rid-1");
    expect(events.result.next).toBe("42");
    expect(events.result.events[0].message.text).toBe("123456");
  });

  /** WB has shipped several spellings of the client payload, and an operator
   * matching a WB chat to a bot conversation only needs a first name. Phone and
   * address are not in the schema at all: what is never parsed cannot leak. */
  it("reads a buyer name from every spelling WB has shipped", () => {
    const parsed = WbDbsClientResponseSchema.parse({
      orders: [
        { orderID: 1, firstName: "Иван" },
        { orderId: "2", fullName: "Пётр Петров" },
        { orderID: 3, fio: "Анна Сергеевна Иванова" },
        { orderID: 4, name: "Мария", phone: 79001234567, fullAddress: "секрет" },
        { orderID: 5 },
      ],
    });
    expect(parsed.orders.map(wbClientOrderId)).toEqual(["1", "2", "3", "4", "5"]);
    expect(parsed.orders.map(wbBuyerName)).toEqual(["Иван", "Пётр", "Анна", "Мария", undefined]);
  });

  /** Verified against the live endpoint on 19.08.2026: WB returns `orderID`,
   * `firstName`, `fullName` alongside `phone`, `replacementPhone`, `phoneCode`,
   * `additionalPhones` and `additionalPhoneCodes`. None of the phone fields may
   * survive parsing — this schema strips instead of passing through. */
  it("drops every phone field WB sends alongside the name", () => {
    const [buyer] = WbDbsClientResponseSchema.parse({
      orders: [{
        orderID: 7,
        firstName: "Иван",
        fullName: "Иван Иванов",
        phone: "79001234567",
        replacementPhone: "79007654321",
        phoneCode: 7,
        additionalPhones: ["79001112233"],
        additionalPhoneCodes: [7],
      }],
    }).orders;
    expect(wbBuyerName(buyer)).toBe("Иван");
    expect(Object.keys(buyer).sort()).toEqual(["firstName", "fullName", "orderID"]);
    expect(JSON.stringify(buyer)).not.toMatch(/7900/);
  });

  it("parses bulk/status results and computes the Moscow delivery window", () => {
    const status = WbStatusesResponseSchema.parse({ orders: [{ orderId: 10, supplierStatus: "deliver", wbStatus: "waiting" }] });
    const mutation = WbBulkMutationResponseSchema.parse({ results: [{ orderId: 10, isError: false }] });
    const window = deliveryWindow({ id: "10", dDate: "2026-08-12", dTimeFrom: "10:00", dTimeTo: "14:00" });
    expect(status.orders[0].orderId).toBe("10");
    expect(mutation.results[0].orderId).toBe("10");
    expect(window.from?.toISOString()).toBe("2026-08-12T07:00:00.000Z");
    expect(window.to?.toISOString()).toBe("2026-08-12T11:00:00.000Z");
  });
});
