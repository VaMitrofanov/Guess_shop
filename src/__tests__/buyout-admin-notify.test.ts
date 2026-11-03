import {
  buildRetailBuyoutAdminCard,
  notifyRetailBuyoutAdmins,
} from "../lib/buyout-admin-notify";

describe("buyout admin notifications", () => {
  const realFetch = global.fetch;
  const realEnv = { ...process.env };

  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...realEnv };
  });

  it("builds a safe human-readable TWA order card", () => {
    const text = buildRetailBuyoutAdminCard({
      source: "twa-order",
      wbCode: "WB<123>",
      gamepassId: "1910603501",
      amount: 500,
      chargedPrice: 715,
      donorName: "Donor<One>",
      sellerName: "Seller&One",
      balance: 3285,
    });

    expect(text).toContain("ВЫКУП · выкуп подтверждён");
    expect(text).toContain("TWA · заказ");
    expect(text).toContain("715 R$");
    expect(text).toContain("3 285 R$");
    expect(text).toContain("WB&lt;123&gt;");
    expect(text).toContain("Donor&lt;One&gt;");
    expect(text).toContain("Seller&amp;One");
  });

  it("broadcasts to every unique ADMIN_IDS recipient", async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (_url: unknown, init: RequestInit) => {
      calls.push(String(init.body));
      return { ok: true, status: 200, text: async () => "" } as Response;
    }) as typeof fetch;
    process.env = {
      ...realEnv,
      TG_TOKEN: "test-token",
      ADMIN_IDS: "111,222,111",
      VALIDATOR_SOURCE_URL: "",
    };

    const result = await notifyRetailBuyoutAdmins({
      source: "twa-account",
      gamepassId: "12345",
      chargedPrice: 715,
    });

    expect(result).toEqual({ admins: 2, sent: 2 });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("111");
    expect(calls[1]).toContain("222");
  });

  it("does not fail when Telegram is not configured", async () => {
    global.fetch = jest.fn() as typeof fetch;
    process.env = { ...realEnv, TG_TOKEN: "", ADMIN_IDS: "", TG_CHAT_ID: "" };

    await expect(notifyRetailBuyoutAdmins({
      source: "twa-order",
      gamepassId: "12345",
      chargedPrice: 715,
    })).resolves.toEqual({ admins: 0, sent: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
