import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canSendWbGate } from "../../bots/shared/wb-delivery-policy";

function read(relative: string) {
  return readFileSync(resolve(__dirname, "../..", relative), "utf8");
}

/** 20.08.2026, заказ WB 5540950769. Покупатель прислал код доставки, WB
 * отклонил его — и через секунду покупателю ушло «Спасибо, код доставки
 * получен! Заказ подтверждён» вместе со ссылкой на получение. Доставка при этом
 * осталась открытой; закрывать её пришлось руками из кабинета.
 *
 * Правило владельца: сначала закрывается доставка, и только потом покупатель
 * получает код на проход. Иначе случайный набор цифр в чате открывает выдачу.
 * Проверяется на обоих контурах сразу — воркер и консоль обязаны жить по одному
 * правилу, иначе кнопка оператора обходит то, что чинили в автоматике. */
describe("гейт уходит только за закрытой доставкой", () => {
  it("правило одно и то же для воркера и для консоли", () => {
    expect(read("bots/shared/wb-delivery-sync.ts")).toContain("if (!canSendWbGate(order)) return;");
    expect(read("src/lib/wb-delivery-workflow.ts")).toContain("if (!canSendWbGate(order)) {");
  });

  it("незакрытая доставка не даёт отправить гейт ни автоматом, ни кнопкой", () => {
    expect(canSendWbGate({ completedAt: null, cancelledAt: null })).toBe(false);
    expect(canSendWbGate({ completedAt: new Date(), cancelledAt: null })).toBe(true);
  });

  it("кнопка в консоли гаснет, а не падает 409 при нажатии", () => {
    const console_ = read("src/lib/wb-delivery-workflow.ts");
    expect(console_).toContain("sendGate: deliverable && canSendWbGate(order)");
    // И объясняет оператору, почему: молча погасшая кнопка читается как поломка.
    expect(console_).toContain("пока доставка не закрыта на WB");
    expect(console_).toContain("DELIVERY_NOT_CLOSED");
  });

  /** Отменённый заказ — деньги вернулись покупателю; закрытый по нему заказ
   * выдачи не открывает. */
  it("отмена перебивает закрытие", () => {
    expect(canSendWbGate({ completedAt: new Date(), cancelledAt: new Date() })).toBe(false);
  });

  /** Тестовый заказ не делает ни одного вызова к WB, поэтому «закрытым» он не
   * станет никогда — демо-прогон обязан оставаться проходимым. */
  it("тестовый заказ идёт по флоу без WB", () => {
    expect(canSendWbGate({ completedAt: null, cancelledAt: null, isTest: true })).toBe(true);
  });
});
