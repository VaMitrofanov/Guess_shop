import { readFileSync } from "node:fs";
import { join } from "node:path";

/* Уведомление о выкупе по 49ANALQ не дошло, а система считала его отправленным.
 * Отказ терялся на трёх уровнях сразу — каждый закрыт тестом ниже. */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const bridge = read("bots/shared/bridge.ts");
const twaNotify = read("src/lib/twa-notify.ts");
const ordersRoute = read("src/app/api/twa/orders/route.ts");
const tg = read("bots/tg/handlers.ts");

describe("Мост не выдаёт отказ Telegram за успех", () => {
  it("«chat not found» помечается как НЕдоставленное", () => {
    expect(bridge).toContain('respond(200, { ok: true, delivered: false, warning: "chat_not_found" });');
  });

  it("успешная отправка помечается доставленной", () => {
    expect(bridge).toContain("delivered: true");
  });

  it("причина отказа доезжает до вызывающего целиком", () => {
    expect(bridge).toContain('respond(502, { ok: false, delivered: false, error: "tg_error", detail: tgBody, description: desc });');
  });
});

describe("Отправитель читает исход, а не выбрасывает его", () => {
  it("`delivered: false` от моста — это провал доставки", () => {
    expect(twaNotify).toContain("if (j?.delivered === false)");
  });

  it("уведомление о выкупе возвращает исход", () => {
    expect(twaNotify).toContain("): Promise<CompletedNoticeResult> {");
    expect(twaNotify).toContain("return { delivered, bonusDelivered, kind: m.kind, channel };");
  });

  it("вызов больше не плавающий промис с проглоченной ошибкой", () => {
    expect(ordersRoute).not.toContain("notifyOrderCompleted(order.user, orderId, order.amount, order.isDirectOrder).catch(() => {});");
    expect(ordersRoute).toContain("await recordCompletedNotice({");
  });

  it("бот тоже перестал глотать отказ в пустой catch", () => {
    expect(tg).not.toContain("} catch { /* user may have blocked the bot */ }");
    expect(tg).toContain("await recordCompletedNotice(db as never, {");
  });
});

describe("След доставки читается глазами", () => {
  const noticeLib = read("src/lib/notice-delivery.ts");

  it("недоставка называется прямо, а не «отправлено»", () => {
    expect(noticeLib).toContain("[УВЕД-НЕ-ДОШЛО ${stamp}]");
    expect(noticeLib).toContain("покупатель НЕ знает, что заказ закрыт");
  });

  it("частичная доставка отличается от полной", () => {
    expect(noticeLib).toContain("второе сообщение (бонус/отзыв) не дошло");
    expect(noticeLib).toContain("покупатель извещён о выкупе");
  });

  it("недоставка будит админов, а не только пишется в заметку", () => {
    expect(noticeLib).toContain("покупатель НЕ извещён о выкупе");
    expect(noticeLib).toContain("написать покупателю лично");
  });

  it("у карточки заказа есть кнопка повторить уведомление", () => {
    const screen = read("src/app/twa/_components/screens/OrdersScreen.tsx");
    expect(screen).toContain('action: "resend-completed-notice"');
    expect(ordersRoute).toContain('if (action === "resend-completed-notice")');
  });
});
