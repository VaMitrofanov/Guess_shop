jest.mock("@/lib/roblox", () => ({ getRobloxAvatar: jest.fn() }));

import { GET } from "@/app/api/roblox/avatar/[userId]/route";
import { getRobloxAvatar } from "@/lib/roblox";

const lookupAvatar = getRobloxAvatar as jest.Mock;

describe("Roblox avatar proxy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it("streams only the resolved Roblox CDN image with a public cache", async () => {
    lookupAvatar.mockResolvedValue("https://tr.rbxcdn.com/avatar/Png");
    (global.fetch as jest.Mock).mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png" },
    }));

    const response = await GET(new Request("https://robloxbank.ru/api/roblox/avatar/3828548511"), {
      params: Promise.resolve({ userId: "3828548511" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("max-age=86400");
    expect(global.fetch).toHaveBeenCalledWith(new URL("https://tr.rbxcdn.com/avatar/Png"), expect.objectContaining({
      cache: "force-cache",
      headers: { Accept: "image/*" },
    }));
  });

  it("rejects malformed IDs before any Roblox request", async () => {
    const response = await GET(new Request("https://robloxbank.ru/api/roblox/avatar/not-an-id"), {
      params: Promise.resolve({ userId: "not-an-id" }),
    });

    expect(response.status).toBe(404);
    expect(lookupAvatar).not.toHaveBeenCalled();
  });
});
