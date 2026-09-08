import { passFitsAmount, requoteForPass, robuxFromPassPrice } from "../direct-requote";
import { expectedGamepassPrice } from "../gamepass-plan";
import { directPrice } from "../retail-pricing";

/* Заказ на 200 R$ с пассом на 715 R$ (DIR-39544969, 08.09.2026). Правильный
   ответ — не отказ и не «оформим как есть», а честный пересчёт: у пасса есть
   своя цена заказа, и её надо назвать. */

describe("пересчёт прямого заказа под цену пасса", () => {
  it("пасс за 715 R$ — это заказ на 500 R$", () => {
    expect(robuxFromPassPrice(715)).toBe(500);
    const q = requoteForPass({ passPrice: 715 });
    expect(q).not.toBeNull();
    expect(q!.totalAmount).toBe(500);
    expect(q!.amount).toBe(500);
    expect(q!.rublePrice).toBe(directPrice(500));
  });

  it("бонус остаётся у покупателя — платит он только за свою часть", () => {
    const q = requoteForPass({ passPrice: 715, bonus: 100 });
    expect(q!.totalAmount).toBe(500);
    expect(q!.amount).toBe(400);
    expect(q!.rublePrice).toBe(directPrice(400));
  });

  it("персональная скидка вычитается из рублёвой цены", () => {
    const q = requoteForPass({ passPrice: 715, rubleDiscount: 60 });
    expect(q!.rublePrice).toBe(Math.max(0, directPrice(500) - 60));
  });

  it("пересчёт сам себя проверяет: под названный объём нужен ровно этот пасс", () => {
    for (const price of [286, 715, 1429, 2858, 4286]) {
      const q = requoteForPass({ passPrice: price });
      expect(q).not.toBeNull();
      expect(Math.abs(expectedGamepassPrice(q!.totalAmount) - price)).toBeLessThanOrEqual(2);
    }
  });

  it("ниже минимального заказа пересчёта нет — тогда только новый пасс", () => {
    // 100 R$ пасс → 70 R$ заказ, это меньше CUSTOM_MIN.
    expect(requoteForPass({ passPrice: 100 })).toBeNull();
    // Бонус больше, чем несёт пасс: платить не за что.
    expect(requoteForPass({ passPrice: 286, bonus: 200 })).toBeNull();
  });

  it("допуск цены — тот же ±2 R$, что у прайс-гарда выкупа", () => {
    expect(passFitsAmount(715, 500)).toBe(true);
    expect(passFitsAmount(717, 500)).toBe(true);
    expect(passFitsAmount(718, 500)).toBe(false);
    expect(passFitsAmount(286, 200)).toBe(true);
    expect(passFitsAmount(715, 200)).toBe(false);
  });
});
