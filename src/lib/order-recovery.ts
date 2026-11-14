export const ORDER_NOTE_LIMIT = 2000;

type RecoverableOrder = {
  status: string;
  wbCode: string;
  gamepassUrl: string | null;
  isDirectOrder: boolean;
  paidAt: Date | string | null;
  adminNote: string | null;
};

type RestoreToBuyoutResult =
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

/* ── 🔁 Перевыкуп: «выкуплен, но не дошёл» ────────────────────────────────────
   Заказ в «Готово», а покупатель присылает доказательство, что робуксов нет
   (DNZ5WLR, 01.11.2026: закрыт вручную, аккаунт закупки не записан). Обратного
   действия у «Выкуплено» не было, и такой заказ жил только в голове админа.

   Возвращаем его в очередь выкупа ПЕРВЫМ (`priorityAt`) и с меткой `rebuyAt`,
   чтобы в ленте было видно: это не новый заказ, его уже раз закрывали.
   Причина обязательна — её читает тот, кто будет выкупать повторно.
   ────────────────────────────────────────────────────────────────────────── */

const REBUY_REASON_LIMIT = 300;

type RebuyableOrder = RecoverableOrder & {
  heldAt?: Date | string | null;
  completedAt?: Date | string | null;
  purchaserUsername?: string | null;
  splitCount?: number;
  /** Кто нажал «Выкуплено» в прошлый раз (из журнала) — для строки аудита. */
  closedBy?: string | null;
};

type RebuyResult =
  | {
      ok: true;
      data: {
        status: "PENDING";
        pendingAt: Date;
        priorityAt: Date;
        priorityBy: string;
        rebuyAt: Date;
        rebuyReason: string;
        rebuyBy: string;
        completedAt: null;
        robuxUnlockRemindLevel: 0;
        purchaserUsername: null;
        buyoutErrorCode: null;
        isFavorite: false;
        adminNote: string;
      };
    }
  | { ok: false; error: string; status: 400 | 409 };

export function buildRebuyData(
  order: RebuyableOrder,
  reasonRaw: unknown,
  actor: string,
  now = new Date(),
): RebuyResult {
  if (order.status !== "COMPLETED") {
    return { ok: false, error: "Вернуть на перевыкуп можно только выкупленный заказ (из «Готово»)", status: 400 };
  }
  // ❄️ Замороженный заказ не возвращается в очередь ни одной кнопкой.
  if (order.heldAt) {
    return { ok: false, error: "Заказ заморожен — сначала сними заморозку", status: 409 };
  }
  const reason = typeof reasonRaw === "string" ? reasonRaw.trim().slice(0, REBUY_REASON_LIMIT) : "";
  if (!reason) return { ok: false, error: "Причина обязательна: что прислал покупатель", status: 400 };
  if (!order.gamepassUrl && !(order.splitCount && order.splitCount > 0)) {
    return { ok: false, error: "У заказа нет геймпасса — выкупать нечего", status: 409 };
  }

  const day = now.toISOString().slice(0, 10);
  const closed = [
    order.completedAt ? `закрыт ${new Date(order.completedAt).toISOString().slice(0, 10)}` : null,
    order.closedBy ?? null,
  ].filter(Boolean).join(" ");
  const was = [
    closed || null,
    order.purchaserUsername ? `аккаунт ${order.purchaserUsername}` : "вручную",
  ].filter(Boolean).join(", ");
  return {
    ok: true,
    data: {
      status: "PENDING",
      pendingAt: now,
      priorityAt: now,
      priorityBy: actor,
      rebuyAt: now,
      rebuyReason: reason,
      rebuyBy: actor,
      // Таймер «робуксы в Pending» считался от прошлого закрытия — он неверен.
      completedAt: null,
      robuxUnlockRemindLevel: 0,
      // Аккаунт прошлого выкупа: тот же пасс тем же аккаунтом снова не купить
      // (`AlreadyOwned`), поэтому он остаётся в заметке, а не в поле.
      purchaserUsername: null,
      buyoutErrorCode: null,
      isFavorite: false,
      adminNote: appendOrderAudit(
        order.adminNote,
        `[ПЕРЕВЫКУП ${day} от ${actor}] COMPLETED→PENDING (${was}): ${reason}`,
      ),
    },
  };
}
