import {
  deliveryWindow,
  WbBulkMutationResponseSchema,
  WbChatEventsResponseSchema,
  WbChatsResponseSchema,
  WbDbsOrdersResponseSchema,
  WbStatusesResponseSchema,
} from "../../bots/shared/wb-delivery-contract";

describe("WB DBS tolerant API contracts", () => {
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
