/** A WB activation code reaches the buyer one of two ways: printed on a card we
 * shipped, or generated on demand by the DBS courier-delivery gate. The corridor
 * that follows is identical, so the origin is only recoverable from the code's
 * link to its marketplace order — record it on the WbOrder while we still know. */
export type WbOrderSource = "WB" | "WB_DBS";

type MinimalTx = {
  wbMarketplaceOrder: {
    findFirst(args: {
      where: { wbCode: { code: string } };
      select: { wbOrderId: true; adminCardMessages: true };
    }): Promise<{ wbOrderId: string; adminCardMessages: unknown } | null>;
  };
};

/** Всё, что карточке заказа нужно знать о его происхождении: откуда продажа,
 * под каким номером заказ живёт на WB и в какое сообщение упирается его ветка
 * у каждого админа. Раньше отсюда возвращался только источник, и карточка
 * DBS-заказа не могла ни назвать номер WB, ни пришиться к живой карточке. */
export type WbOrderRef = {
  source: WbOrderSource;
  wbOrderId: string | null;
  /** `{ "<adminTgId>": <messageId> }` живой карточки DBS — корень ветки. */
  cardMessages: Record<string, number> | null;
};

const NO_REF: WbOrderRef = { source: "WB", wbOrderId: null, cardMessages: null };

export async function resolveWbOrderRef(tx: unknown, code: string): Promise<WbOrderRef> {
  if (!code) return NO_REF;
  try {
    const row = await (tx as MinimalTx).wbMarketplaceOrder.findFirst({
      where: { wbCode: { code } },
      select: { wbOrderId: true, adminCardMessages: true },
    });
    if (!row) return NO_REF;
    const raw = row.adminCardMessages;
    return {
      source: "WB_DBS",
      wbOrderId: row.wbOrderId,
      cardMessages: raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, number>
        : null,
    };
  } catch {
    return NO_REF;
  }
}

/** Admin cards showed only the platform ("Источник: TG"), which is where the
 * buyer chatted, not where the sale came from — DBS orders were indistinguishable
 * from ordinary WB ones at a glance. */
export function wbOrderSourceLabel(platform: string, orderSource?: string | null): string {
  return orderSource === "WB_DBS" ? `WB DBS → ${platform}` : platform;
}

/** Standalone line for cards that list fields rather than a single source. */
export function wbDbsBadgeLine(orderSource?: string | null): string {
  return orderSource === "WB_DBS" ? "🚚 <b>WB DBS</b> — доставка WB, час на закрытие\n" : "";
}

/** Never throws: a lookup failure must not block order creation, and WB is the
 * safe default because it is what every historical code already is. */
export async function resolveWbOrderSource(tx: unknown, code: string): Promise<WbOrderSource> {
  return (await resolveWbOrderRef(tx, code)).source;
}
