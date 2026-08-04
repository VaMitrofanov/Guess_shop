jest.mock("next/cache", () => ({ revalidateTag: jest.fn() }));
jest.mock("@/lib/admin-access", () => ({ requireAdmin: jest.fn() }));
jest.mock("@/lib/admin-settings", () => ({
  AdminSettingsValidationError: class AdminSettingsValidationError extends Error {},
  loadAdminSettingsOverview: jest.fn(),
  updateAdminSettings: jest.fn(),
}));

import { revalidateTag } from "next/cache";
import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import { updateAdminSettings } from "@/lib/admin-settings";
import { POST } from "@/app/api/admin/settings/route";

describe("admin settings web adapter", () => {
  afterEach(() => jest.clearAllMocks());

  it("rejects requests without the current admin session", async () => {
    (requireAdmin as jest.Mock).mockResolvedValue(null);
    const response = await POST(new NextRequest("http://localhost/api/admin/settings", {
      method: "POST",
      body: JSON.stringify({ usdToRub: 92 }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(updateAdminSettings).not.toHaveBeenCalled();
  });

  it("accepts a web admin session and invalidates financial reads", async () => {
    (requireAdmin as jest.Mock).mockResolvedValue({ userId: "admin-1" });
    (updateAdminSettings as jest.Mock).mockResolvedValue({
      purchaseRate: 4.7,
      usdToRub: 92,
      autoBuyEnabled: false,
      autoBuyRate: 4,
    });
    const response = await POST(new NextRequest("http://localhost/api/admin/settings", {
      method: "POST",
      body: JSON.stringify({ usdToRub: 92, purchaseRate: 4.7 }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(200);
    expect(updateAdminSettings).toHaveBeenCalledWith({ usdToRub: 92, purchaseRate: 4.7 });
    expect(revalidateTag).toHaveBeenCalledWith("admin-finance", "max");
    expect(revalidateTag).toHaveBeenCalledWith("admin-economics", "max");
  });
});
