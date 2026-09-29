import {
  DIRECT_DISCOUNT_RUBLES,
  decideDirectDiscount,
  grantDirectDiscountOnCompletion,
} from "../direct-discount";

const base = {
  isDirectOrder: true,
  amount: 100,
  bonusAppliedRobux: 0,
  completedDirectOrders: 1,
  grantedAt: null as Date | null,
};

describe("decideDirectDiscount — правило владельца от 20.08.2026", () => {
  it("(б) первый прямой заказ меньше 500 R$ без бонуса — 60 ₽ на вторую покупку", () => {
    expect(decideDirectDiscount({ ...base, amount: 200 })).toEqual({
      granted: true,
      rubles: DIRECT_DISCOUNT_RUBLES,
    });
  });

  it("(а) бонус на первом заказе активирован — второй заказ по фулл-прайсу", () => {
    expect(decideDirectDiscount({ ...base, amount: 200, bonusAppliedRobux: 100 })).toEqual({
      granted: false,
      reason: "bonus_used",
    });
  });

  it("(в) первый заказ от 500 R$ без бонуса — скидки тоже нет", () => {
    expect(decideDirectDiscount({ ...base, amount: 500 })).toEqual({
      granted: false,
      reason: "first_order_too_large",
    });
    expect(decideDirectDiscount({ ...base, amount: 1400 })).toEqual({
      granted: false,
      reason: "first_order_too_large",
    });
  });

  it("даёт скидку только на первом завершённом прямом заказе", () => {
    expect(decideDirectDiscount({ ...base, completedDirectOrders: 2 })).toEqual({
      granted: false,
      reason: "not_first_direct_order",
    });
  });

  it("выдаётся один раз за всё время", () => {
    expect(decideDirectDiscount({ ...base, grantedAt: new Date("2026-07-28") })).toEqual({
      granted: false,
      reason: "already_granted",
    });
  });

  it("заказ WB прямым не считается", () => {
    expect(decideDirectDiscount({ ...base, isDirectOrder: false })).toEqual({
      granted: false,
      reason: "not_direct",
    });
  });
});

/** Реальная история клиента `leertsss`: пять прямых заказов, пять скидок.
 *  Каждый следующий стоил 84 ₽ вместо 144 ₽ — около 300 ₽ недобора. */
describe("петля, из-за которой правило и переписали", () => {
  const history = [
    { amount: 200, bonusAppliedRobux: 100 }, // 27.07 — бонус активирован
    { amount: 500, bonusAppliedRobux: 0 },
    { amount: 100, bonusAppliedRobux: 0 },
    { amount: 100, bonusAppliedRobux: 0 },
    { amount: 100, bonusAppliedRobux: 0 },
  ];

  it("на всей истории выдаёт ноль скидок: на первом заказе был бонус", () => {
    let grantedAt: Date | null = null;
    let granted = 0;
    history.forEach((order, index) => {
      const decision = decideDirectDiscount({
        ...order,
        isDirectOrder: true,
        completedDirectOrders: index + 1,
        grantedAt,
      });
      if (decision.granted) {
        granted += 1;
        grantedAt = new Date();
      }
    });
    expect(granted).toBe(0);
  });

  it("два прямых заказа подряд без бонуса дают ровно одну скидку", () => {
    let grantedAt: Date | null = null;
    let granted = 0;
    for (let index = 0; index < 5; index += 1) {
      const decision = decideDirectDiscount({
        isDirectOrder: true,
        amount: 100,
        bonusAppliedRobux: 0,
        completedDirectOrders: index + 1,
        grantedAt,
      });
      if (decision.granted) {
        granted += 1;
        grantedAt = new Date();
      }
    }
    expect(granted).toBe(1);
  });
});

type DiscountDb = Parameters<typeof grantDirectDiscountOnCompletion>[0];

function makeDb(state: {
  grantedAt?: Date | null;
  bonusAppliedRobux?: number | null;
  amount?: number;
  completedDirectOrders?: number;
  ledgerRedemptions?: number;
}) {
  const user = { directDiscountGrantedAt: state.grantedAt ?? null, rubleDiscount: 0 };
  return {
    user,
    db: {
      user: {
        findUnique: async () => ({ directDiscountGrantedAt: user.directDiscountGrantedAt }),
        updateMany: async ({ where, data }: {
          where: { directDiscountGrantedAt: Date | null };
          data: { rubleDiscount: number; directDiscountGrantedAt: Date };
        }) => {
          if (where.directDiscountGrantedAt === null && user.directDiscountGrantedAt) return { count: 0 };
          user.directDiscountGrantedAt = data.directDiscountGrantedAt;
          user.rubleDiscount = data.rubleDiscount;
          return { count: 1 };
        },
      },
      wbOrder: {
        findUnique: async () => ({
          bonusAppliedRobux: state.bonusAppliedRobux === undefined ? 0 : state.bonusAppliedRobux,
          amount: state.amount ?? 100,
        }),
        count: async () => state.completedDirectOrders ?? 1,
      },
      bonusLedger: { count: async () => state.ledgerRedemptions ?? 0 },
    },
  };
}

describe("grantDirectDiscountOnCompletion", () => {
  it("начисляет 60 ₽ и помечает выдачу", async () => {
    const { user, db } = makeDb({});
    const decision = await grantDirectDiscountOnCompletion(db as unknown as DiscountDb, {
      userId: "u1", orderId: "o1", amount: 100, isDirectOrder: true,
    });
    expect(decision).toEqual({ granted: true, rubles: 60 });
    expect(user.rubleDiscount).toBe(60);
    expect(user.directDiscountGrantedAt).toBeInstanceOf(Date);
  });

  it("второе завершение по тому же пользователю ничего не начисляет", async () => {
    const { user, db } = makeDb({});
    await grantDirectDiscountOnCompletion(db as unknown as DiscountDb, {
      userId: "u1", orderId: "o1", amount: 100, isDirectOrder: true,
    });
    const second = await grantDirectDiscountOnCompletion(db as unknown as DiscountDb, {
      userId: "u1", orderId: "o2", amount: 100, isDirectOrder: true,
    });
    expect(second).toEqual({ granted: false, reason: "already_granted" });
    expect(user.rubleDiscount).toBe(60);
  });

  // `bonusAppliedRobux` писал только TG-путь; у VK-заказов он NULL. Принять
  // NULL за ноль — значит выдать скидку тому, кто бонусом воспользовался.
  it("при пустом снапшоте бонуса верит журналу бонусов", async () => {
    const { user, db } = makeDb({ bonusAppliedRobux: null, ledgerRedemptions: 1 });
    const decision = await grantDirectDiscountOnCompletion(db as unknown as DiscountDb, {
      userId: "u1", orderId: "o1", amount: 100, isDirectOrder: true,
    });
    expect(decision).toEqual({ granted: false, reason: "bonus_used" });
    expect(user.rubleDiscount).toBe(0);
  });

  it("пустой снапшот без списаний в журнале — бонуса не было", async () => {
    const { db } = makeDb({ bonusAppliedRobux: null, ledgerRedemptions: 0 });
    await expect(grantDirectDiscountOnCompletion(db as unknown as DiscountDb, {
      userId: "u1", orderId: "o1", amount: 100, isDirectOrder: true,
    })).resolves.toEqual({ granted: true, rubles: 60 });
  });

  it("гонка двух каналов на одном заказе даёт одну скидку", async () => {
    const { user, db } = makeDb({});
    const [a, b] = await Promise.all([
      grantDirectDiscountOnCompletion(db as unknown as DiscountDb, { userId: "u1", orderId: "o1", amount: 100, isDirectOrder: true }),
      grantDirectDiscountOnCompletion(db as unknown as DiscountDb, { userId: "u1", orderId: "o1", amount: 100, isDirectOrder: true }),
    ]);
    expect([a.granted, b.granted].filter(Boolean)).toHaveLength(1);
    expect(user.rubleDiscount).toBe(60);
  });
});
