export const ORDER_NOTE_LIMIT = 2000;

export type RecoverableOrder = {
  status: string;
  wbCode: string;
  gamepassUrl: string | null;
  isDirectOrder: boolean;
  paidAt: Date | string | null;
  adminNote: string | null;
};

export type RestoreToBuyoutResult =
  | {
      ok: true;
      data: {
        status: "PENDING";
        buyoutErrorCode: null;
        pendingAt: Date;
        adminNote: string;
      };
    }
  | { ok: false; error: string; status: 400 | 409 };

/** Keep the newest operational history when the legacy 2,000-char note is full. */
export function appendOrderAudit(note: string | null | undefined, line: string): string {
  const current = note?.trim() ?? "";
  if (current.split("\n").includes(line)) return current;
  const combined = current ? `${current}\n${line}` : line;
  return combined.length <= ORDER_NOTE_LIMIT
    ? combined
    : combined.slice(combined.length - ORDER_NOTE_LIMIT);
}

/**
 * Manual recovery is deliberately separate from purchase: it only returns a
 * valid ERROR order to its source-specific buyout queue and never calls Roblox.
 */
export function buildRestoreToBuyoutData(
  order: RecoverableOrder,
  actor: string,
  now = new Date(),
): RestoreToBuyoutResult {
  if (order.status !== "ERROR") {
    return { ok: false, error: "Вернуть к выкупу можно только заказ из папки «Ошибка»", status: 400 };
  }
  if (!order.gamepassUrl) {
    return {
      ok: false,
      error: "Сначала добавь геймпасс или переведи заказ в «Ждут ссылку»",
      status: 409,
    };
  }
  if (order.isDirectOrder && !order.paidAt) {
    return {
      ok: false,
      error: `💳 Прямой заказ ${order.wbCode} не оплачен — сначала подтверди оплату`,
      status: 409,
    };
  }

  const day = now.toISOString().slice(0, 10);
  return {
    ok: true,
    data: {
      status: "PENDING",
      buyoutErrorCode: null,
      pendingAt: now,
      adminNote: appendOrderAudit(
        order.adminNote,
        `[ВОЗВРАТ ${day} от ${actor}] ERROR→PENDING, геймпасс сохранён`,
      ),
    },
  };
}
