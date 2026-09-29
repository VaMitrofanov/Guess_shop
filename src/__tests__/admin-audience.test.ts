jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: jest.fn() } } }));

import {
  filterAdminAudienceUsers,
  getCommunityAudienceMetrics,
  summarizeAdminAudience,
  toAdminAudienceUser,
} from "@/lib/admin-audience";

const realFetch = global.fetch;
const realEnv = process.env;

function sourceUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    name: "Client",
    username: "client",
    email: null,
    emailVerifiedAt: null,
    role: "USER",
    tgId: null,
    vkId: null,
    createdAt: new Date("2026-07-20T00:00:00Z"),
    identities: [],
    _count: { wbOrders: 0 },
    ...overrides,
  };
}

describe("admin audience", () => {
  beforeEach(() => {
    process.env = { ...realEnv, ADMIN_IDS: "111" };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = realFetch;
    process.env = realEnv;
  });

  it("keeps legacy social profiles in totals and reports missing canonical identities", () => {
    const telegram = toAdminAudienceUser(sourceUser({ tgId: "111", _count: { wbOrders: 2 } }));
    const vk = toAdminAudienceUser(sourceUser({ id: "user-2", vkId: "222" }));
    const linked = toAdminAudienceUser(sourceUser({
      id: "user-3",
      email: "client@example.test",
      emailVerifiedAt: new Date("2026-07-21T00:00:00Z"),
      identities: [
        { provider: "TG", subject: "333", metadata: { username: "client_tg" } },
        { provider: "VK", subject: "444", metadata: { username: "client_vk" } },
        { provider: "EMAIL", subject: "client@example.test", metadata: null },
      ],
    }));

    const summary = summarizeAdminAudience([telegram, vk, linked], new Date("2026-07-29T00:00:00Z"));
    expect(summary).toEqual(expect.objectContaining({
      totalProfiles: 3,
      tgProfiles: 2,
      vkProfiles: 2,
      tgVk: 1,
      repeatBuyers: 1,
      legacyOnlyProfiles: 2,
      legacyOnlyTg: 1,
      legacyOnlyVk: 1,
    }));
    expect(telegram.isAdmin).toBe(false);
    expect(linked.channelDetails).toEqual([
      { channel: "TG", subject: "333", username: "client_tg", canonical: true },
      { channel: "VK", subject: "444", username: "client_vk", canonical: true },
      { channel: "EMAIL", subject: "client@example.test", username: null, canonical: true },
    ]);
    expect(filterAdminAudienceUsers([telegram, vk, linked], "tg")).toHaveLength(2);
    expect(filterAdminAudienceUsers([telegram, vk, linked], "multi")).toEqual([linked]);
  });

  it("counts an administrator only from a verified Telegram identity", () => {
    const admin = toAdminAudienceUser(sourceUser({
      identities: [{ provider: "TG", subject: "111", metadata: null }],
    }));
    expect(admin.isAdmin).toBe(true);
    expect(admin.legacyOnlyChannels).toEqual([]);
  });

  it("reads live Telegram and VK community sizes without exposing tokens to the UI DTO", async () => {
    process.env.TG_TOKEN = "tg-secret";
    process.env.TG_CHANNEL_ID = "@Roblox_Bank_Tg";
    process.env.VK_TOKEN = "vk-secret";
    process.env.VK_GROUP_ID = "237309399";

    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, result: 310 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, result: { title: "Roblox Bank", username: "Roblox_Bank_Tg" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ response: { groups: [{ name: "Roblox Bank", screen_name: "bankroblox", members_count: 218 }] } }) });

    await expect(getCommunityAudienceMetrics()).resolves.toEqual([
      expect.objectContaining({ platform: "TG", members: 310, status: "ok", handle: "@Roblox_Bank_Tg" }),
      expect.objectContaining({ platform: "VK", members: 218, status: "ok", handle: "bankroblox" }),
    ]);
  });

  it("degrades community metrics instead of failing the admin page", async () => {
    process.env.TG_TOKEN = "tg-secret";
    process.env.VK_TOKEN = "vk-secret";
    process.env.VK_GROUP_ID = "237309399";
    global.fetch = jest.fn().mockRejectedValue(new Error("network down"));

    const metrics = await getCommunityAudienceMetrics();
    expect(metrics.map((metric) => metric.status)).toEqual(["error", "error"]);
    expect(metrics.map((metric) => metric.members)).toEqual([null, null]);
  });

  it("routes Telegram reads through the authenticated bridge when configured", async () => {
    delete process.env.TG_TOKEN;
    process.env.TG_CHANNEL_ID = "@Roblox_Bank_Tg";
    process.env.VALIDATOR_SOURCE_URL = "https://bridge.example.test";
    process.env.VALIDATOR_KEY = "validator-secret";

    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, result: 310 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, result: { title: "Roblox Bank", username: "Roblox_Bank_Tg" } }) });

    const [telegram] = await getCommunityAudienceMetrics();
    expect(telegram).toEqual(expect.objectContaining({ members: 310, status: "ok" }));
    expect(global.fetch).toHaveBeenNthCalledWith(1, "https://bridge.example.test/tg-proxy", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "x-validator-key": "validator-secret" }),
    }));
    expect(String((global.fetch as jest.Mock).mock.calls[0][1].body)).not.toContain("token");
  });
});
