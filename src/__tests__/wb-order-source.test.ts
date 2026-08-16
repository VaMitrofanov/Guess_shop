import { resolveWbOrderSource } from "../../bots/shared/wb-order-source";

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
      select: { id: true },
    });
  });
});
