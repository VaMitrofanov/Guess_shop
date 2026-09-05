import {
  MAX_AUTO_PARTS,
  SPLIT_PLANS,
  coveredRobux,
  idealTargetsFor,
  netFromPrice,
  planFromOwned,
  targetsToCreate,
  type OwnedPass,
} from "@/lib/gamepass-plan";
import { expectedGamepassPrice } from "@/lib/purchase-guard";

const pass = (id: string, price: number, extra: Partial<OwnedPass> = {}): OwnedPass => ({
  gamepassId: id,
  name: String(price),
  price,
  ...extra,
});

describe("SPLIT_PLANS", () => {
  it("каждая раскладка складывается ровно в свой номинал", () => {
    for (const [amount, parts] of Object.entries(SPLIT_PLANS)) {
      expect(parts.reduce((sum, part) => sum + part, 0)).toBe(Number(amount));
    }
  });

  it("2000 просится двумя пассами, и вместе они стоят столько же, сколько один", () => {
    expect(idealTargetsFor(2000)).toEqual([1500, 500]);
    const split = idealTargetsFor(2000).reduce((sum, part) => sum + expectedGamepassPrice(part), 0);
    expect(split).toBe(expectedGamepassPrice(2000));
    expect(split).toBe(2858);
  });

  it("остальные номиналы остаются одним пассом", () => {
    expect(idealTargetsFor(1000)).toEqual([1000]);
    expect(idealTargetsFor(1200)).toEqual([1200]);
  });

  it("цена пасса и номинал — обратные друг другу", () => {
    for (const amount of [300, 500, 800, 1000, 1200, 1500, 2000]) {
      expect(netFromPrice(expectedGamepassPrice(amount))).toBe(amount);
    }
  });
});

describe("planFromOwned", () => {
  it("идеальная пара под 2000 закрывает заказ без повторов", () => {
    const plan = planFromOwned(2000, [pass("1", 2143), pass("2", 715)]);
    expect(plan.kind).toBe("ready");
    expect(coveredRobux(plan)).toBe(2000);
    expect(targetsToCreate(plan)).toEqual([]);
  });

  it("один пасс ровно под номинал — тоже готовый заказ", () => {
    const plan = planFromOwned(1000, [pass("1", 1429)]);
    expect(plan.kind).toBe("ready");
    if (plan.kind !== "ready") throw new Error("unreachable");
    expect(plan.parts).toHaveLength(1);
    expect(plan.parts[0].amount).toBe(1000);
  });

  it("один пасс на 715 закрывает 1000 двумя выкупами — создавать второй не просим", () => {
    const plan = planFromOwned(1000, [pass("1", 715)]);
    expect(plan.kind).toBe("assembled");
    if (plan.kind !== "assembled") throw new Error("unreachable");
    expect(plan.parts.map((part) => part.amount)).toEqual([500, 500]);
    expect(plan.parts[0].repeat).toBe(false);
    expect(plan.parts[1].repeat).toBe(true);
    expect(targetsToCreate(plan)).toEqual([]);
  });

  it("одинаковые номиналы разводятся по разным пассам, пока разные есть", () => {
    const plan = planFromOwned(1000, [pass("1", 715), pass("2", 715)]);
    expect(plan.kind).toBe("ready");
    if (plan.kind !== "ready") throw new Error("unreachable");
    expect(new Set(plan.parts.map((part) => part.gamepassId)).size).toBe(2);
  });

  it("2000 собирается из 1000 + 500 + 500 с повтором мелкого пасса", () => {
    const plan = planFromOwned(2000, [pass("big", 1429), pass("small", 715)]);
    expect(plan.kind).toBe("assembled");
    expect(coveredRobux(plan)).toBe(2000);
  });

  it("когда точной суммы не собрать — просит создать ровно один пасс", () => {
    // 800 + 800 = 1600, 800 * 3 = 2400 — мимо 2000.
    const plan = planFromOwned(2000, [pass("1", 1143)]);
    expect(plan.kind).toBe("build");
    if (plan.kind !== "build") throw new Error("unreachable");
    expect(targetsToCreate(plan)).toHaveLength(1);
    expect(coveredRobux(plan) + plan.create.amount).toBe(2000);
    expect(plan.create.price).toBe(expectedGamepassPrice(plan.create.amount));
    // Меньше частей лучше: одна восьмисотка плюс новый пасс на 1200.
    expect(plan.parts).toHaveLength(1);
    expect(plan.create.amount).toBe(1200);
  });

  it("пасс на 1000 R$ даёт 700 на руки — под тысячу просит достроить 300", () => {
    const plan = planFromOwned(1000, [pass("1", 1000)]);
    expect(plan.kind).toBe("build");
    if (plan.kind !== "build") throw new Error("unreachable");
    expect(coveredRobux(plan)).toBe(700);
    expect(plan.create).toEqual({ amount: 300, price: expectedGamepassPrice(300) });
  });

  it("пустой аккаунт получает набор с нуля по таблице", () => {
    const plan = planFromOwned(2000, []);
    expect(plan.kind).toBe("empty");
    expect(targetsToCreate(plan).map((t) => t.price)).toEqual([2143, 715]);
    expect(coveredRobux(plan)).toBe(0);
  });

  it("снятые с продажи и занятые чужим заказом пассы не считаются", () => {
    const plan = planFromOwned(1000, [
      pass("off", 1429, { isForSale: false }),
      pass("busy", 1429, { busyWith: "AB12CD3" }),
    ]);
    expect(plan.kind).toBe("empty");
  });

  it("не разваливает заказ на больше частей, чем мы готовы выкупить", () => {
    // 100 на руки × 20 частей — арифметически сходится, операционно нет.
    const plan = planFromOwned(2000, [pass("1", 143)]);
    expect(plan.kind).not.toBe("ready");
    expect(plan.kind).not.toBe("assembled");
  });

  it("потолок частей соблюдается и в собранном наборе", () => {
    const plan = planFromOwned(2000, [pass("1", 715)]);
    if (plan.kind === "ready" || plan.kind === "assembled" || plan.kind === "build") {
      expect(plan.parts.length).toBeLessThanOrEqual(MAX_AUTO_PARTS);
    }
  });

  it("на сайте набор всегда один пасс: оформление несёт один gamepassId", () => {
    const site = { maxParts: 1, splitPlan: false } as const;
    expect(planFromOwned(2000, [], site)).toEqual({
      kind: "empty",
      create: [{ amount: 2000, price: expectedGamepassPrice(2000) }],
    });
    // Пасс на 715 закрывает 1000 только двумя выкупами. Один заказ сайта несёт
    // один пасс, поэтому засчитать его нечем — просим создать ровный.
    expect(planFromOwned(1000, [pass("1", 715)], site).kind).toBe("empty");
    expect(planFromOwned(1000, [pass("1", 1429)], site).kind).toBe("ready");
  });

  it("мусорный номинал не роняет разбор", () => {
    expect(planFromOwned(0, [pass("1", 715)]).kind).toBe("empty");
    expect(planFromOwned(-5, [pass("1", 715)]).kind).toBe("empty");
  });
});
