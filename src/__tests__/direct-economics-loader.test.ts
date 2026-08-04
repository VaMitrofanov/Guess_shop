jest.mock("@/lib/prisma", () => ({
  prisma: {
    wbOrder: { findMany: jest.fn() },
    bonusLedger: { findMany: jest.fn() },
    directIntent: { findMany: jest.fn() },
    globalSettings: { findUnique: jest.fn() },
  },
}));
jest.mock("@/lib/retail-pricing", () => ({ DIRECT_PRICES: { 100: 144 } }));

import { prisma } from "@/lib/prisma";
import { loadDirectEconomics } from "@/lib/direct-economics";

const db = prisma as unknown as {
  wbOrder: { findMany: jest.Mock };
  bonusLedger: { findMany: jest.Mock };
  directIntent: { findMany: jest.Mock };
  globalSettings: { findUnique: jest.Mock };
};

function order(index: number) {
  const createdAt = new Date(1_800_000_000_000 - index * 1000);
  return {
    id: `order-${String(index).padStart(4, "0")}`,
    wbCode: `CODE${index}`,
    orderSource: "SITE",
    platform: "WEB",
    userId: `user-${index}`,
    amount: 100,
    robloxUsername: `user${index}`,
    saleAmountKopecks: 14_400,
    purchaseCostKopecks: null,
    purchaseRobuxAmount: null,
    purchaseRateUsdPer1k: null,
    purchaseUsdToRub: null,
    bonusAppliedRobux: 0,
    paidAt: createdAt,
    createdAt,
    completedAt: createdAt,
  };
}

describe("direct economics loader", () => {
  afterEach(() => jest.clearAllMocks());

  it("requests newest rows with a stable order and reports an honest truncation", async () => {
    db.wbOrder.findMany.mockResolvedValue(Array.from({ length: 2001 }, (_, index) => order(index)));
    db.bonusLedger.findMany.mockResolvedValue([]);
    db.directIntent.findMany.mockResolvedValue([]);
    db.globalSettings.findUnique.mockResolvedValue({ purchaseRate: 4.7, usdToRub: 92 });

    const result = await loadDirectEconomics();

    expect(db.wbOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2001,
    }));
    expect(result.orders).toHaveLength(2000);
    expect(result.orders[0].id).toBe("order-0000");
    expect(result.orders.at(-1)?.id).toBe("order-1999");
    expect(result.truncated).toBe(true);
  });
});
