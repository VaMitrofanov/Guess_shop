jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: jest.fn(), update: jest.fn() } },
}));
jest.mock("@/lib/roblox", () => ({
  getRobloxPublicProfile: jest.fn(),
  getRobloxPublicProfileById: jest.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getRobloxPublicProfile, getRobloxPublicProfileById } from "@/lib/roblox";
import { disconnectCustomerRobloxProfile, loadCustomerRobloxProfile } from "@/lib/roblox-profile";

const db = prisma as unknown as {
  user: { findUnique: jest.Mock; update: jest.Mock };
};
const lookupByUsername = getRobloxPublicProfile as jest.Mock;
const lookupById = getRobloxPublicProfileById as jest.Mock;

describe("customer Roblox profile consent boundary", () => {
  afterEach(() => jest.clearAllMocks());

  it("keeps a historical order nick as a suggestion until the customer confirms it", async () => {
    db.user.findUnique.mockResolvedValue({
      robloxUsername: null,
      robloxUserId: null,
      robloxDisplayName: null,
      robloxAvatarUrl: null,
      robloxDescription: null,
      robloxAccountCreatedAt: null,
      robloxProfileSyncedAt: null,
    });

    await expect(loadCustomerRobloxProfile("user-1", "KrytishVadim4ic")).resolves.toEqual({
      status: "missing-username",
      profile: null,
      suggestedUsername: "KrytishVadim4ic",
    });
    expect(lookupByUsername).not.toHaveBeenCalled();
    expect(lookupById).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("returns a fresh confirmed cached profile without another Roblox request", async () => {
    db.user.findUnique.mockResolvedValue({
      robloxUsername: "Builderman",
      robloxUserId: "156",
      robloxDisplayName: "Builderman",
      robloxAvatarUrl: "https://tr.rbxcdn.com/avatar.png",
      robloxDescription: "Roblox profile",
      robloxAccountCreatedAt: new Date("2006-03-01T00:00:00.000Z"),
      robloxProfileSyncedAt: new Date(),
    });

    const result = await loadCustomerRobloxProfile("user-1", "OtherOrderNick");
    expect(result.status).toBe("ok");
    expect(result.profile).toEqual(expect.objectContaining({ id: "156", username: "Builderman", stale: false }));
    expect(result.suggestedUsername).toBe("Builderman");
    expect(lookupByUsername).not.toHaveBeenCalled();
    expect(lookupById).not.toHaveBeenCalled();
  });

  it("clears every cached field when the customer disconnects the profile", async () => {
    db.user.update.mockResolvedValue({});
    await disconnectCustomerRobloxProfile("user-1");
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        robloxUsername: null,
        robloxUserId: null,
        robloxDisplayName: null,
        robloxAvatarUrl: null,
        robloxDescription: null,
        robloxAccountCreatedAt: null,
        robloxProfileSyncedAt: null,
      },
    });
  });
});
