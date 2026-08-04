jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/prisma", () => ({
  prisma: {
    globalSettings: { findUnique: jest.fn(), upsert: jest.fn() },
    marketRate: { findFirst: jest.fn() },
    wbOrder: { count: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  AdminSettingsValidationError,
  loadAdminSettingsOverview,
  parseAdminSettingsUpdate,
  updateAdminSettings,
} from "@/lib/admin-settings";

const db = prisma as unknown as {
  globalSettings: { findUnique: jest.Mock; upsert: jest.Mock };
  marketRate: { findFirst: jest.Mock };
  wbOrder: { count: jest.Mock };
};

describe("admin settings service", () => {
  afterEach(() => jest.clearAllMocks());

  it("parses strict rate changes and rejects boolean coercion", () => {
    expect(parseAdminSettingsUpdate({ usdToRub: "91.5", purchaseRate: 4.7 })).toEqual({
      usdToRub: 91.5,
      purchaseRate: 4.7,
    });
    expect(() => parseAdminSettingsUpdate({ autoBuyEnabled: "false" })).toThrow(
      AdminSettingsValidationError,
    );
    expect(() => parseAdminSettingsUpdate({ purchaseRate: 0 })).toThrow("purchaseRate out of range");
  });

  it("returns safe defaults without a settings row", async () => {
    db.globalSettings.findUnique.mockResolvedValue(null);
    db.marketRate.findFirst.mockResolvedValue(null);
    db.wbOrder.count.mockResolvedValue(3);

    await expect(loadAdminSettingsOverview()).resolves.toEqual({
      purchaseRate: null,
      usdToRub: 90,
      autoBuyEnabled: false,
      autoBuyRate: 4,
      bestRate: null,
      pendingOrders: 3,
    });
  });

  it("updates only validated fields through the shared command", async () => {
    db.globalSettings.upsert.mockResolvedValue({
      purchaseRate: 4.7,
      usdToRub: 92,
      autoBuyEnabled: false,
      autoBuyRate: 4,
    });

    await expect(updateAdminSettings({ purchaseRate: 4.7, usdToRub: 92 })).resolves.toEqual({
      purchaseRate: 4.7,
      usdToRub: 92,
      autoBuyEnabled: false,
      autoBuyRate: 4,
    });
    expect(db.globalSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "global" },
      update: { purchaseRate: 4.7, usdToRub: 92 },
    }));
  });
});
