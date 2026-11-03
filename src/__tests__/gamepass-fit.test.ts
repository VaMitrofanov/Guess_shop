import { classifyGamepasses, type PickerPass } from "@/lib/gamepass-fit";

/* Раскладка пассов ника по пригодности к заказу. Правило цены одно с
   прайс-гардом, и тесты стерегут именно это: карточка не должна звать
   подходящим то, что гард выкупа остановит. */

const pass = (over: Partial<PickerPass> & { gamepassId: string; price: number }): PickerPass => ({
  name: `Pass ${over.gamepassId}`,
  amount: Math.floor(over.price * 7 / 10),
  busyWith: null,
  ...over,
});

describe("classifyGamepasses", () => {
  it("под номинал заказа — ровно ceil(amount / 0.7)", () => {
    const groups = classifyGamepasses({
      passes: [pass({ gamepassId: "1", price: 2858 })],
      orderAmount: 2000,
    });
    expect(groups.order.map(row => row.gamepassId)).toEqual(["1"]);
    expect(groups.part).toHaveLength(0);
    expect(groups.rest).toHaveLength(0);
  });

  it("допуск тот же, что у гарда: ±2 R$ подходит, 3 — уже нет", () => {
    const groups = classifyGamepasses({
      passes: [
        pass({ gamepassId: "ok", price: 2856 }),
        pass({ gamepassId: "no", price: 2861 }),
      ],
      orderAmount: 2000,
    });
    expect(groups.order.map(row => row.gamepassId)).toEqual(["ok"]);
    expect(groups.rest.map(row => row.gamepassId)).toEqual(["no"]);
  });

  it("текущий пасс заказа не дублируется в группах", () => {
    const groups = classifyGamepasses({
      passes: [pass({ gamepassId: "1963249295", price: 2858 })],
      orderAmount: 2000,
      currentId: "1963249295",
    });
    expect(groups.current?.kind).toBe("current");
    expect(groups.order).toHaveLength(0);
  });

  it("занятый другим заказом уезжает в остальные и не предлагается к постановке", () => {
    const groups = classifyGamepasses({
      passes: [pass({ gamepassId: "1", price: 2858, busyWith: "PCMVDH4" })],
      orderAmount: 2000,
    });
    expect(groups.order).toHaveLength(0);
    expect(groups.rest[0].kind).toBe("busy");
    expect(groups.rest[0].busyWith).toBe("PCMVDH4");
  });

  it("без разбивки в «часть» идёт тот, кем остаток собирается ТОЧНО", () => {
    const groups = classifyGamepasses({
      passes: [
        pass({ gamepassId: "cheap", price: 1429 }), // 1000 + 1000 = 2000 ✓
        pass({ gamepassId: "dear", price: 4290 }),  // дороже заказа
      ],
      orderAmount: 2000,
    });
    expect(groups.part.map(row => row.gamepassId)).toEqual(["cheap"]);
    expect(groups.part[0].partAmount).toBeNull();
    expect(groups.rest.map(row => row.gamepassId)).toEqual(["dear"]);
  });

  it("дешёвый, но не складывающийся в точную сумму, в «часть» НЕ идёт", () => {
    const groups = classifyGamepasses({
      // 1200 из номиналов 1000 / 500 / 35 не собирается ни одной комбинацией,
      // и звать оператора в разбиение такими пассами — обещать невозможное.
      passes: [
        pass({ gamepassId: "p1000", price: 1429 }),
        pass({ gamepassId: "p500", price: 715 }),
        pass({ gamepassId: "tip", price: 50 }),
      ],
      orderAmount: 1200,
    });
    expect(groups.part).toHaveLength(0);
    expect(groups.rest.map(row => row.gamepassId).sort()).toEqual(["p1000", "p500", "tip"]);
  });

  it("складывающийся втроём — идёт", () => {
    const groups = classifyGamepasses({
      // 1500 = 500 + 500 + 500: один и тот же пасс можно взять трижды.
      passes: [pass({ gamepassId: "p500", price: 715 })],
      orderAmount: 1500,
    });
    expect(groups.part.map(row => row.gamepassId)).toEqual(["p500"]);
  });

  it("с разбивкой годится только тот, кто закрывает НЕЗАКРЫТУЮ часть", () => {
    const groups = classifyGamepasses({
      passes: [
        pass({ gamepassId: "part1000", price: 1429 }),
        pass({ gamepassId: "part500", price: 715 }),
        pass({ gamepassId: "someCheap", price: 900 }),
      ],
      orderAmount: 2000,
      parts: [
        { amount: 1000, purchasedAt: null },
        { amount: 1000, purchasedAt: "2026-09-04T00:00:00.000Z" },
      ],
    });
    expect(groups.part.map(row => row.gamepassId)).toEqual(["part1000"]);
    expect(groups.part[0].partAmount).toBe(1000);
    // 500 закрывает часть, которой в этой разбивке нет, — это не «часть».
    expect(groups.rest.map(row => row.gamepassId).sort()).toEqual(["part500", "someCheap"]);
  });

  it("total считает все пассы аккаунта, включая тот, что уже на заказе", () => {
    const groups = classifyGamepasses({
      passes: [
        pass({ gamepassId: "cur", price: 2858 }),
        pass({ gamepassId: "other", price: 715 }),
      ],
      orderAmount: 2000,
      currentId: "cur",
    });
    expect(groups.total).toBe(2);
  });
});
