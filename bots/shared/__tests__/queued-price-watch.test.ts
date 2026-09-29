export {};

import { expectedGamepassPrice } from "../gamepass-plan";
import { priceWatchFlagged, priceWatchTargets, type PriceWatchPart } from "../queued-price-watch";

const part = (over: Partial<PriceWatchPart> & { gamepassId: string; amount: number; position: number }): PriceWatchPart => ({
  purchasedAt: null,
  ...over,
});

describe("что сторожить у заказа в очереди", () => {
  it("у обычного заказа — его единственный пасс и его номинал", () => {
    expect(priceWatchTargets({ amount: 1000, gamepassId: "777", splitGamepasses: [] }))
      .toEqual([{ gamepassId: "777", amount: 1000, partLabel: null }]);
  });

  it("пасса нет — сторожить нечего", () => {
    expect(priceWatchTargets({ amount: 1000, gamepassId: null, splitGamepasses: [] })).toEqual([]);
  });

  /**
   * Тот самый ложный алерт: заказ NE4SWXJ на 1000 R$ закрыт двумя частями по
   * 500, у каждой пасс за 715 R$. Сверка с номиналом ЗАКАЗА ждала 1429 R$ и
   * кричала «цену подменили» на цене, которую сама же и приняла.
   */
  it("у разбитого заказа эталон — номинал ЧАСТИ, а не заказа", () => {
    const targets = priceWatchTargets({
      amount: 1000,
      gamepassId: "1020399015",
      splitGamepasses: [
        part({ gamepassId: "1020399015", amount: 500, position: 0 }),
        part({ gamepassId: "1020399015", amount: 500, position: 1 }),
      ],
    });
    expect(targets).toHaveLength(1);
    expect(targets[0].amount).toBe(500);
    expect(expectedGamepassPrice(targets[0].amount)).toBe(715);
    expect(targets[0].partLabel).toBe("часть 1 из 2");
  });

  it("разные пассы в разбивке сторожатся по отдельности", () => {
    const targets = priceWatchTargets({
      amount: 2000,
      gamepassId: "A",
      splitGamepasses: [
        part({ gamepassId: "A", amount: 1500, position: 0 }),
        part({ gamepassId: "B", amount: 500, position: 1 }),
      ],
    });
    expect(targets.map((t) => [t.gamepassId, t.amount])).toEqual([["A", 1500], ["B", 500]]);
  });

  it("купленная часть уже списана — её цена ничего не решает", () => {
    const targets = priceWatchTargets({
      amount: 2000,
      gamepassId: "A",
      splitGamepasses: [
        part({ gamepassId: "A", amount: 1500, position: 0, purchasedAt: new Date() }),
        part({ gamepassId: "B", amount: 500, position: 1 }),
      ],
    });
    expect(targets.map((t) => t.gamepassId)).toEqual(["B"]);
  });
});

describe("повторный алерт по тому же пассу", () => {
  const note = "[ЦЕНА-ИЗМЕНИЛАСЬ 2026-09-10 18:31] пасс 111 (часть 1 из 2, номинал 500 R$): 900 R$ вместо 715 R$";

  it("молчит про уже помеченный пасс", () => {
    expect(priceWatchFlagged(note, "111")).toBe(true);
  });

  /** Метка на первом пассе не должна затыкать сторожа на втором. */
  it("не молчит про соседний пасс того же заказа", () => {
    expect(priceWatchFlagged(note, "222")).toBe(false);
  });

  it("обычная заметка админа меткой не считается", () => {
    expect(priceWatchFlagged("клиент писал про пасс 111, обещал переделать", "111")).toBe(false);
  });
});
