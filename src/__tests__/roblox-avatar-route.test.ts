jest.mock("@/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/prisma", () => ({
  prisma: { userRobloxAccount: { findFirst: jest.fn() } },
}));

import { GET } from "@/app/api/account/roblox-avatar/[accountId]/route";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const authenticate = auth as jest.Mock;
const findAccount = prisma.userRobloxAccount.findFirst as jest.Mock;

describe("Roblox avatar proxy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    authenticate.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("streams only the signed-in user's saved Roblox CDN image", async () => {
    findAccount.mockResolvedValue({ avatarUrl: "https://tr.rbxcdn.com/avatar/Png" });
    (global.fetch as jest.Mock).mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png" },
    }));

    const response = await GET(new Request("https://robloxbank.ru/api/account/roblox-avatar/account_123"), {
      params: Promise.resolve({ accountId: "account_123" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(findAccount).toHaveBeenCalledWith({
      where: { id: "account_123", userId: "user-1", hiddenAt: null },
      select: { avatarUrl: true },
    });
    expect(global.fetch).toHaveBeenCalledWith(new URL("https://tr.rbxcdn.com/avatar/Png"), expect.objectContaining({
      cache: "force-cache",
      headers: { Accept: "image/*" },
    }));
  });

  it("rejects malformed account IDs before a database or Roblox request", async () => {
    const response = await GET(new Request("https://robloxbank.ru/api/account/roblox-avatar/no"), {
      params: Promise.resolve({ accountId: "no" }),
    });

    expect(response.status).toBe(404);
    expect(findAccount).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    authenticate.mockResolvedValue(null);

    const response = await GET(new Request("https://robloxbank.ru/api/account/roblox-avatar/account_123"), {
      params: Promise.resolve({ accountId: "account_123" }),
    });

    expect(response.status).toBe(401);
    expect(findAccount).not.toHaveBeenCalled();
  });
});
