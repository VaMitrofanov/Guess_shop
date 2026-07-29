jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), update: jest.fn() },
    wbOrder: { findMany: jest.fn() },
    userRobloxAccount: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/roblox", () => ({
  getRobloxPublicProfile: jest.fn(),
  getRobloxPublicProfileById: jest.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getRobloxPublicProfile, getRobloxPublicProfileById } from "@/lib/roblox";
import {
  loadCustomerRobloxProfile,
  selectCustomerRobloxAccount,
  syncCustomerRobloxAccountsFromOrders,
} from "@/lib/roblox-profile";

const db = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock };
  wbOrder: { findMany: jest.Mock };
  userRobloxAccount: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    upsert: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  $transaction: jest.Mock;
};
const lookupByUsername = getRobloxPublicProfile as jest.Mock;
const lookupById = getRobloxPublicProfileById as jest.Mock;

const now = new Date("2026-07-30T00:00:00.000Z");
const accountRow = (overrides: Record<string, unknown> = {}) => ({
  id: "account-1",
  userId: "user-1",
  robloxUserId: "156",
  username: "Builderman",
  usernameNormalized: "builderman",
  displayName: "Builderman",
  avatarUrl: "https://tr.rbxcdn.com/avatar.png",
  description: "Roblox profile",
  accountCreatedAt: new Date("2006-03-01T00:00:00.000Z"),
  profileSyncedAt: now,
  source: "ORDER_HISTORY",
  orderCount: 2,
  firstOrderAt: new Date("2026-07-01T00:00:00.000Z"),
  lastOrderAt: new Date("2026-07-29T00:00:00.000Z"),
  selectedAt: new Date("2026-07-29T00:00:00.000Z"),
  hiddenAt: null,
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
  updatedAt: now,
  ...overrides,
});

describe("customer Roblox account projection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.user.update.mockResolvedValue({});
    db.userRobloxAccount.upsert.mockResolvedValue(accountRow());
    db.$transaction.mockImplementation((input: unknown) => Array.isArray(input) ? Promise.all(input) : input);
  });

  it("queries only this user's non-test paid or completed orders", async () => {
    db.wbOrder.findMany.mockResolvedValue([
      { robloxUsername: "Builderman", createdAt: new Date("2026-07-29T00:00:00.000Z") },
      { robloxUsername: "builderman", createdAt: new Date("2026-07-01T00:00:00.000Z") },
    ]);
    db.userRobloxAccount.findMany.mockResolvedValue([]);

    await syncCustomerRobloxAccountsFromOrders("user-1");

    expect(db.wbOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: "user-1",
        isTest: false,
        robloxUsername: { not: null },
        OR: [{ paidAt: { not: null } }, { status: "COMPLETED" }],
      },
    }));
    expect(db.userRobloxAccount.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ source: "ORDER_HISTORY", orderCount: 2 }),
      update: expect.objectContaining({ source: "ORDER_HISTORY", orderCount: 2 }),
    }));
  });

  it("returns the latest order-backed account without another Roblox request when cache is fresh", async () => {
    db.user.findUnique.mockResolvedValue({
      id: "user-1",
      robloxUsername: null,
      robloxUserId: null,
      robloxDisplayName: null,
      robloxAvatarUrl: null,
      robloxDescription: null,
      robloxAccountCreatedAt: null,
      robloxProfileSyncedAt: null,
      updatedAt: now,
    });
    db.wbOrder.findMany.mockResolvedValue([]);
    db.userRobloxAccount.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        accountRow({ id: "older", username: "OlderNick", usernameNormalized: "oldernick", lastOrderAt: new Date("2026-07-15T00:00:00.000Z"), selectedAt: null }),
        accountRow(),
      ]);

    const result = await loadCustomerRobloxProfile("user-1");

    expect(result.status).toBe("ok");
    expect(result.profile).toEqual(expect.objectContaining({
      accountId: "account-1",
      username: "Builderman",
      source: "ORDER_HISTORY",
      orderCount: 2,
      selected: true,
    }));
    expect(result.accounts).toHaveLength(2);
    expect(lookupByUsername).not.toHaveBeenCalled();
    expect(lookupById).not.toHaveBeenCalled();
  });

  it("does not import a nickname left by an old unpaid checkout draft", async () => {
    db.user.findUnique.mockResolvedValue({
      id: "user-1",
      robloxUsername: "UnpaidDraftNick",
      robloxUserId: null,
      robloxDisplayName: null,
      robloxAvatarUrl: null,
      robloxDescription: null,
      robloxAccountCreatedAt: null,
      robloxProfileSyncedAt: null,
      updatedAt: now,
    });
    db.wbOrder.findMany.mockResolvedValue([]);
    db.userRobloxAccount.findMany.mockResolvedValue([]);

    await expect(loadCustomerRobloxProfile("user-1")).resolves.toEqual({
      status: "missing-username",
      profile: null,
      accounts: [],
      suggestedUsername: null,
    });
    expect(db.userRobloxAccount.upsert).not.toHaveBeenCalled();
    expect(lookupByUsername).not.toHaveBeenCalled();
    expect(lookupById).not.toHaveBeenCalled();
  });

  it("scopes an account switch to the signed-in owner", async () => {
    db.userRobloxAccount.findFirst.mockResolvedValue(null);

    await expect(selectCustomerRobloxAccount("user-1", "someone-elses-account")).resolves.toEqual({
      status: "not-found",
      profile: null,
      accounts: [],
      suggestedUsername: null,
    });
    expect(db.userRobloxAccount.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "someone-elses-account", userId: "user-1", hiddenAt: null },
    }));
    expect(db.userRobloxAccount.update).not.toHaveBeenCalled();
  });
});
