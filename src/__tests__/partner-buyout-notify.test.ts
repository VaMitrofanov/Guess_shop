import {
  buildPartnerBuyoutCard,
  notifyPartnerBuyout,
  pluralizeGamepass,
  type PartnerBuyoutNotifyItem,
} from "../lib/partner-buyout-notify";

const NOW = new Date("2026-07-12T18:30:00Z"); // 21:30 МСК

function item(over: Partial<PartnerBuyoutNotifyItem> = {}): PartnerBuyoutNotifyItem {
  return { nick: "AlphaBlaz", gamepassId: "12345", robux: 2000, usdt: 10.1, ...over };
}

describe("pluralizeGamepass", () => {
  it("declines by Russian number rules", () => {
    expect(pluralizeGamepass(1)).toBe("геймпасс");
    expect(pluralizeGamepass(2)).toBe("геймпасса");
    expect(pluralizeGamepass(4)).toBe("геймпасса");
    expect(pluralizeGamepass(5)).toBe("геймпассов");
    expect(pluralizeGamepass(11)).toBe("геймпассов"); // 11–14 always plural
    expect(pluralizeGamepass(14)).toBe("геймпассов");
    expect(pluralizeGamepass(21)).toBe("геймпасс");
    expect(pluralizeGamepass(22)).toBe("геймпасса");
    expect(pluralizeGamepass(0)).toBe("геймпассов");
  });
});

describe("buildPartnerBuyoutCard", () => {
  it("summarises a batch buyout for the admin card", () => {
    const card = buildPartnerBuyoutCard({
      partnerName: "Антон",
      items: [item({ nick: "AlphaBlaz", gamepassId: "111", robux: 2000, usdt: 10.1 }),
              item({ nick: "Neo", gamepassId: "222", robux: 3000, usdt: 15.15 })],
      totalRobux: 5000,
      totalUsdt: 25.25,
      balanceUsdt: 71.62,
      rate: 5.05,
      failCount: 0,
      operator: "@manager",
      now: NOW,
    });

    expect(card).toContain("ВЫКУП ПАРТНЁРА · Антон");
    expect(card).toContain("Выкуплено: <b>2 геймпасса</b>");
    expect(card).toContain("25.25 USDT");
    expect(card).toContain("Курс: <b>5.05 USDT / 1000 R$</b>");
    expect(card).toContain("Остаток баланса: <b>71.62 USDT</b>");
    expect(card).toContain("• AlphaBlaz · GP 111 · 2");
    expect(card).toContain("• Neo · GP 222 · 3");
    expect(card).toContain("Оператор: @manager");
    expect(card).toContain("21:30 МСК");
    // No failures → no fail line.
    expect(card).not.toContain("Ошибок в пачке");
  });

  it("shows the failure count when the batch had errors", () => {
    const card = buildPartnerBuyoutCard({
      partnerName: "Антон",
      items: [item()],
      totalRobux: 2000,
      totalUsdt: 10.1,
      balanceUsdt: 5,
      rate: 5.05,
      failCount: 3,
      now: NOW,
    });
    expect(card).toContain("Выкуплено: <b>1 геймпасс</b>");
    expect(card).toContain("Ошибок в пачке: <b>3</b>");
  });

  it("truncates long batches to the first 12 lines", () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      item({ nick: `nick${i}`, gamepassId: String(i), robux: 100, usdt: 0.5 }));
    const card = buildPartnerBuyoutCard({
      partnerName: "Антон",
      items,
      totalRobux: 1500,
      totalUsdt: 7.5,
      balanceUsdt: 0,
      rate: 5.05,
      now: NOW,
    });
    expect(card).toContain("• nick0 · GP 0 · 100 R$");
    expect(card).toContain("• nick11 · GP 11 · 100 R$");
    expect(card).not.toContain("• nick12");
    expect(card).toContain("…и ещё 3");
  });

  it("escapes user-controlled text and handles missing fields", () => {
    const card = buildPartnerBuyoutCard({
      partnerName: "Антон",
      items: [item({ nick: "<b>hax</b>", gamepassId: null })],
      totalRobux: 2000,
      totalUsdt: 10.1,
      balanceUsdt: 1,
      rate: 5.05,
      now: NOW,
    });
    expect(card).toContain("&lt;b&gt;hax&lt;/b&gt;");
    expect(card).not.toContain("<b>hax</b>");
    expect(card).toContain("GP —");
  });
});

describe("notifyPartnerBuyout (broadcast fan-out)", () => {
  const realFetch = global.fetch;
  const realEnv = { ...process.env };

  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...realEnv };
  });

  it("sends one admin card per unique ADMIN_IDS entry", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    global.fetch = jest.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      return { ok: true, status: 200, text: async () => "" } as any;
    }) as any;

    process.env = { ...realEnv, TG_TOKEN: "test-token", ADMIN_IDS: "111,222,111", VALIDATOR_SOURCE_URL: "" };

    const result = await notifyPartnerBuyout({
      partnerName: "Антон",
      items: [item({ nick: "AlphaBlaz", gamepassId: "111", robux: 2000, usdt: 10.1 })],
      totalRobux: 2000,
      totalUsdt: 10.1,
      balanceUsdt: 90,
      rate: 5.05,
      now: NOW,
    });

    expect(result).toEqual({ admins: 2, sent: 2 });
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toContain("111"); // chat_id of first admin
    expect(calls[1].body).toContain("222"); // chat_id of second admin
    expect(calls[0].body).toContain("ВЫКУП ПАРТНЁРА");
  });

  it("no-ops safely when no admins are configured", async () => {
    global.fetch = jest.fn() as any;
    process.env = { ...realEnv, TG_TOKEN: "test-token", ADMIN_IDS: "", TG_CHAT_ID: "" };

    const result = await notifyPartnerBuyout({
      partnerName: "Антон",
      items: [item()],
      totalRobux: 2000,
      totalUsdt: 10.1,
      balanceUsdt: 0,
      rate: 5.05,
      now: NOW,
    });

    expect(result).toEqual({ admins: 0, sent: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not broadcast an empty buyout", async () => {
    global.fetch = jest.fn() as any;
    process.env = { ...realEnv, TG_TOKEN: "test-token", ADMIN_IDS: "111" };

    const result = await notifyPartnerBuyout({
      partnerName: "Антон",
      items: [],
      totalRobux: 0,
      totalUsdt: 0,
      balanceUsdt: 0,
      rate: 5.05,
      now: NOW,
    });

    expect(result).toEqual({ admins: 1, sent: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
