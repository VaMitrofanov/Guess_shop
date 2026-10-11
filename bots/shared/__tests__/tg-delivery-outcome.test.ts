import { tgDeliveryOutcome } from "../notify";

// GP-watch решает по этому исходу, повторять ли пинг и будить ли админов.
// Ошибка в сторону «временный» = алерт каждый час (FLBDVYK, 11.10.2026).
describe("tgDeliveryOutcome", () => {
  it("доставлено — ответ моста и прямой ответ Telegram", () => {
    expect(tgDeliveryOutcome({ ok: true, delivered: true, result: { message_id: 1 } })).toBe("delivered");
    expect(tgDeliveryOutcome({ ok: true, result: { message_id: 1 } })).toBe("delivered");
  });

  it("заблокировал бота — навсегда (мост отдаёт 502 с описанием)", () => {
    expect(tgDeliveryOutcome({
      ok: false, delivered: false, error: "tg_error",
      description: "Forbidden: bot was blocked by the user",
      detail: { description: "Forbidden: bot was blocked by the user" },
    })).toBe("permanent");
  });

  it("прямой ответ Telegram без моста — тоже навсегда", () => {
    expect(tgDeliveryOutcome({ ok: false, description: "Forbidden: user is deactivated" })).toBe("permanent");
  });

  it("мост глотает «chat not found» как ok + delivered:false — это не доставка", () => {
    expect(tgDeliveryOutcome({ ok: true, delivered: false, warning: "chat_not_found" })).toBe("permanent");
  });

  it("мост не ответил или Telegram недоступен — временно", () => {
    expect(tgDeliveryOutcome({})).toBe("transient");
    expect(tgDeliveryOutcome(null)).toBe("transient");
    expect(tgDeliveryOutcome({ ok: false, delivered: false, error: "tg_unreachable" })).toBe("transient");
    expect(tgDeliveryOutcome({ ok: false, description: "Too Many Requests: retry after 5" })).toBe("transient");
  });
});
