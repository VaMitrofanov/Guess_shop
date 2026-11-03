import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveWbOrderSource, wbDbsBadgeLine, wbOrderSourceLabel } from "../../bots/shared/wb-order-source";

function read(relative: string) {
  return readFileSync(resolve(__dirname, "../..", relative), "utf8");
}

function tx(marketplaceOrder: { id: string } | null, fail = false) {
  return {
    wbMarketplaceOrder: {
      findFirst: jest.fn(async () => {
        if (fail) throw new Error("db down");
        return marketplaceOrder;
      }),
    },
  };
}

describe("WB order source resolution", () => {
  it("marks a code issued by the DBS gate as WB_DBS", async () => {
    await expect(resolveWbOrderSource(tx({ id: "mkt-1" }), "QUN5YFZ")).resolves.toBe("WB_DBS");
  });

  it("leaves a printed-card code as plain WB", async () => {
    await expect(resolveWbOrderSource(tx(null), "ABC1234")).resolves.toBe("WB");
  });

  /** Classifying the source is bookkeeping — it must never be the reason a
   * buyer's order fails to be created. */
  it("falls back to WB instead of throwing when the lookup fails", async () => {
    await expect(resolveWbOrderSource(tx(null, true), "ABC1234")).resolves.toBe("WB");
    await expect(resolveWbOrderSource(tx({ id: "mkt-1" }), "")).resolves.toBe("WB");
  });

  it("looks the code up by its relation, not by batch naming", async () => {
    const client = tx({ id: "mkt-1" });
    await resolveWbOrderSource(client, "QUN5YFZ");
    expect(client.wbMarketplaceOrder.findFirst).toHaveBeenCalledWith({
      where: { wbCode: { code: "QUN5YFZ" } },
      select: { wbOrderId: true, adminCardMessages: true },
    });
  });
});

describe("DBS visibility in admin cards", () => {
  it("puts the source ahead of the platform, which is only where they chatted", () => {
    expect(wbOrderSourceLabel("TG", "WB_DBS")).toBe("WB DBS → TG");
    expect(wbOrderSourceLabel("VK", "WB_DBS")).toBe("WB DBS → VK");
    expect(wbOrderSourceLabel("TG", "WB")).toBe("TG");
    expect(wbOrderSourceLabel("TG", null)).toBe("TG");
  });

  it("adds a standalone badge only for DBS", () => {
    expect(wbDbsBadgeLine("WB_DBS")).toContain("WB DBS");
    expect(wbDbsBadgeLine("WB")).toBe("");
    expect(wbDbsBadgeLine(null)).toBe("");
  });

  /** Every admin surface must show it, or the orders blend together again. */
  it("is rendered on every order card and new-client notification", () => {
    for (const file of ["bots/shared/admin.ts", "bots/tg/handlers.ts", "bots/tg/admin/hub-orders.ts"]) {
      expect(read(file)).toContain("wbOrderSourceLabel(order.platform");
    }
    for (const file of ["bots/tg/handlers.ts", "bots/vk/handlers.ts"]) {
      expect(read(file)).toContain("wbDbsBadgeLine(");
    }
    // No card may print the bare platform as the source any more.
    for (const file of ["bots/shared/admin.ts", "bots/tg/handlers.ts", "bots/tg/admin/hub-orders.ts"]) {
      expect(read(file)).not.toMatch(/Источник: <b>\$\{(order\.platform|pe)\}/);
    }
  });

  /** A DBS buyer opens the gate from the WB chat link, so the site's VK login
   * usually creates the order before the bot ever sees the code. Any creation
   * path that forgets to classify the source silently keeps the schema default
   * `WB` — that is how order 5508907054 (code ZM4XAW3) lost its DBS origin. */
  it("classifies the source at every order creation in the corridor", () => {
    for (const file of ["src/auth.ts", "bots/tg/handlers.ts", "bots/vk/handlers.ts"]) {
      const source = read(file);
      const creations = [...source.matchAll(/wbOrder\.create\(\{/g)];
      expect(creations.length).toBeGreaterThan(0);
      for (const creation of creations) {
        const start = creation.index ?? 0;
        const next = source.indexOf("wbOrder.create({", start + 1);
        const block = source.slice(start, next < 0 ? start + 1200 : Math.min(next, start + 1200));
        expect(block).toMatch(/orderSource:/);
      }
    }
  });
});
