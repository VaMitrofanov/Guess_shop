import { summarizeOrderContacts } from "@/lib/order-contact";
import { replyForOrder } from "@/lib/order-reply";
import { primaryActionFor as primaryAction } from "@/lib/order-presentation";

const at = (iso: string) => new Date(iso);

describe("обращения покупателя в карточке (16.11.2026)", () => {
  it("считает только живые обращения: «спасибо» и эхо не в счёт", () => {
    const map = summarizeOrderContacts([
      { orderId: "a", at: at("2026-11-15T10:00:00Z"), channel: "TG", text: "где робуксы?", kind: "rush" },
      { orderId: "a", at: at("2026-11-15T12:00:00Z"), channel: "TG", text: "спасибо", kind: "quiet" },
      { orderId: "a", at: at("2026-11-16T09:00:00Z"), channel: "WB", text: "уже месяц в очереди", kind: "rush" },
      { orderId: "b", at: at("2026-11-16T09:00:00Z"), channel: "VK", text: "ок", kind: "quiet" },
    ]);
    expect(map.get("b")).toBeUndefined();
    const a = map.get("a")!;
    expect(a.count).toBe(2);
    expect(a.lastChannel).toBe("WB");
    expect(a.lastText).toBe("уже месяц в очереди");
  });

  it("самое горячее побеждает: просьба вернуть деньги важнее «торопит»", () => {
    const map = summarizeOrderContacts([
      { orderId: "a", at: at("2026-11-15T10:00:00Z"), channel: "TG", text: "верните деньги", kind: "cancel" },
      { orderId: "a", at: at("2026-11-15T11:00:00Z"), channel: "TG", text: "когда?", kind: "rush" },
    ]);
    expect(map.get("a")!.kind).toBe("cancel");
  });

  it("пустая кнопка «Статус» не затирает последнюю цитату", () => {
    const map = summarizeOrderContacts([
      { orderId: "a", at: at("2026-11-15T10:00:00Z"), channel: "TG", text: "где заказ", kind: "rush" },
      { orderId: "a", at: at("2026-11-15T11:00:00Z"), channel: "TG", text: null, kind: "rush" },
    ]);
    expect(map.get("a")!.lastText).toBe("где заказ");
  });

  it("ответ клиенту без сроков, выкупленному — общий текст ожидания Pending", () => {
    const queue = replyForOrder({ status: "PENDING", gamepassUrl: "https://www.roblox.com/game-pass/1", robloxUsername: "nick" });
    expect(queue).toMatch(/в очереди на выкуп/);
    expect(queue).not.toMatch(/\d+\s*(час|дн|мин)/);
    expect(replyForOrder({ status: "AWAITING_GAMEPASS" })).toMatch(/геймпасс/);
    expect(replyForOrder({ status: "COMPLETED" })).toMatch(/Pending/);
    expect(replyForOrder({ status: "PENDING", heldAt: "2026-11-16T00:00:00Z", gamepassUrl: "x" })).toMatch(/на проверке/);
  });
});

describe("главное действие при неверной цене пасса", () => {
  const order = {
    status: "PENDING", gamepassUrl: "https://www.roblox.com/game-pass/2064123179", gamepassId: "2064123179",
    splitGamepasses: [], heldAt: null, isDirectOrder: false, orderSource: "WB_DBS",
  };
  it("цена не та — «Написать», а не зелёная «Выкуплено»", () => {
    const action = primaryAction(order as never, { isForSale: true, priceMismatch: true, livePrice: 1702, expected: 715 } as never);
    expect(action?.kind).toBe("contact");
  });
  it("цена сходится — «Выкуплено»", () => {
    const action = primaryAction(order as never, { isForSale: true, priceMismatch: false, livePrice: 715, expected: 715 } as never);
    expect(action?.label).toBe("Выкуплено");
  });
});
