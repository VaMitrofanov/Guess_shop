/** A WB activation code reaches the buyer one of two ways: printed on a card we
 * shipped, or generated on demand by the DBS courier-delivery gate. The corridor
 * that follows is identical, so the origin is only recoverable from the code's
 * link to its marketplace order — record it on the WbOrder while we still know. */
export type WbOrderSource = "WB" | "WB_DBS";

type MinimalTx = {
  wbMarketplaceOrder: {
    findFirst(args: {
      where: { wbCode: { code: string } };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

/** Never throws: a lookup failure must not block order creation, and WB is the
 * safe default because it is what every historical code already is. */
export async function resolveWbOrderSource(tx: unknown, code: string): Promise<WbOrderSource> {
  if (!code) return "WB";
  try {
    const marketplaceOrder = await (tx as MinimalTx).wbMarketplaceOrder.findFirst({
      where: { wbCode: { code } },
      select: { id: true },
    });
    return marketplaceOrder ? "WB_DBS" : "WB";
  } catch {
    return "WB";
  }
}
