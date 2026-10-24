import {
  DONOR_NET_CAPACITY,
  MAX_AUTO_PARTS,
  coveredRobux,
  isAllowedPartAmount,
  splitIntoDonorChunks,
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

describe("разбивка под донора (1500 чистых на аккаунт)", () => {
  it("номинал, который влезает в донора, не дробится вовсе", () => {
    for (const amount of [300, 500, 800, 1000, 1200, 1500]) {
      expect(idealTargetsFor(amount)).toEqual([amount]);
    }
  });

  it("выше донора — куски по 1500, остаток последней частью", () => {
    expect(splitIntoDonorChunks(2000)).toEqual([1500, 500]);
    expect(splitIntoDonorChunks(2500)).toEqual([1500, 1000]);
    expect(splitIntoDonorChunks(3000)).toEqual([1500, 1500]);
    expect(splitIntoDonorChunks(5000)).toEqual([1500, 1500, 1500, 500]);
  });

  it("огрызка мельче шага не бывает: 1700 — это 1000 + 700, а не 1500 + 200", () => {
    expect(splitIntoDonorChunks(1700)).toEqual([1000, 700]);
    expect(splitIntoDonorChunks(1501)).toEqual([1000, 501]);
    expect(splitIntoDonorChunks(3200)).toEqual([1500, 1000, 700]);
    expect(splitIntoDonorChunks(2037)).toEqual([1500, 537]);
    for (const amount of [1501, 1600, 1700, 2000, 2037, 2100, 2500, 3000, 3200, 5000]) {
      const parts = splitIntoDonorChunks(amount);
      expect(parts.reduce((sum, part) => sum + part, 0)).toBe(amount);
      for (const part of parts) expect(part).toBeLessThanOrEqual(DONOR_NET_CAPACITY);
    }
  });

  it("то, что разбивка просит создать, разбор и принимает — без цикла «создай ещё раз»", () => {
    // До 24.09.2026: 1600 → «создай 800 + 800», созданные пассы отвергались
    // `isAllowedPartAmount`, и план снова говорил «пусто».
    for (const amount of [1501, 1600, 1700, 1800, 2037, 2100, 3200, 5999]) {
      const created = idealTargetsFor(amount).map((part, i) => pass(String(i + 1), expectedGamepassPrice(part)));
      for (const part of idealTargetsFor(amount)) expect(isAllowedPartAmount(part, amount)).toBe(true);
      const plan = planFromOwned(amount, created);
      expect(["ready", "assembled"]).toContain(plan.kind);
      expect(coveredRobux(plan)).toBe(amount);
    }
  });

  it("некратная часть законна, только если несёт хвост самого заказа", () => {
    expect(isAllowedPartAmount(700, 1700)).toBe(true);
    expect(isAllowedPartAmount(700, 2000)).toBe(false);
    expect(isAllowedPartAmount(700, 1200)).toBe(false); // влезает в донора — одним пассом
    expect(isAllowedPartAmount(200, 1700)).toBe(false); // мельче шага — огрызок
  });

  it("разбивка не крадёт у покупателя: сумма цен частей равна цене целого", () => {
    const split = idealTargetsFor(2000).reduce((sum, part) => sum + expectedGamepassPrice(part), 0);
    expect(split).toBe(expectedGamepassPrice(2000));
    expect(split).toBe(2858);
  });

  it("1500 одним пассом — единственное, что влезает в донора целиком", () => {
    // Округление цены вверх съедает баланс: 715 × 3 = 2145 и 1429 + 715 = 2144
    // не помещаются в 2143, которые стоит один пасс на 1500.
    expect(expectedGamepassPrice(1500)).toBe(2143);
    expect(expectedGamepassPrice(500) * 3).toBeGreaterThan(expectedGamepassPrice(1500));
    expect(expectedGamepassPrice(1000) + expectedGamepassPrice(500)).toBeGreaterThan(expectedGamepassPrice(1500));
  });

  it("часть — либо кратная 500 в пределах донора, либо весь заказ целиком", () => {
    expect(isAllowedPartAmount(500, 2000)).toBe(true);
    expect(isAllowedPartAmount(1500, 2000)).toBe(true);
    expect(isAllowedPartAmount(800, 800)).toBe(true);   // номинал ВБ, дробить нечем
    expect(isAllowedPartAmount(800, 2000)).toBe(false); // а как ЧАСТЬ — уже огрызок
    expect(isAllowedPartAmount(430, 2000)).toBe(false);
    expect(isAllowedPartAmount(2000, 2000)).toBe(false); // больше донора
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

  it("некратная часть в разбивку не берётся, даже когда сумма сошлась бы", () => {
    // Пасс на 1143 R$ = 800 на руки. Раньше он засчитывался, и заказ на 2000
    // закрывался парой «800 + 1200»: два донора, и у обоих остаётся огрызок,
    // которым не закрыть следующую часть. Теперь просим эталонный набор.
    const plan = planFromOwned(2000, [pass("1", 1143)]);
    expect(plan.kind).toBe("empty");
    expect(targetsToCreate(plan).map((t) => t.amount)).toEqual([1500, 500]);
  });

  it("пасс на 700 на руки под тысячу не годится — просим один пасс на 1000", () => {
    const plan = planFromOwned(1000, [pass("1", 1000)]);
    expect(plan.kind).toBe("empty");
    expect(targetsToCreate(plan)).toEqual([{ amount: 1000, price: expectedGamepassPrice(1000) }]);
  });

  it("достраиваем только рабочей частью: 2000 при пассе на 1500 — плюс 500", () => {
    const plan = planFromOwned(2000, [pass("1", 2143)]);
    expect(plan.kind).toBe("build");
    if (plan.kind !== "build") throw new Error("unreachable");
    expect(coveredRobux(plan)).toBe(1500);
    expect(plan.create).toEqual({ amount: 500, price: expectedGamepassPrice(500) });
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
