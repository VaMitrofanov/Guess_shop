/* Данные покупателя для ИИ-поддержки — одни для всех каналов. */

import { customerContext, type PaAiOrder } from "./pa-ai-support";
import { CODE_VIAS, codeOrderContextLine } from "./order-contacts";
import { NOT_FOREIGN_REVIEW } from "./buyout-gate";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const RISK_KINDS = ["BAD_REVIEW", "REVIEW_FIXED", "REVIEW_DELETED", "CLAIM_OPENED", "REFUND_OPEN", "REFUND_AFTER_DELIVERY"];

function riskLine(r: { kind: string; wbCode: string | null; stars: number | null; starsBefore: number | null; text: string | null; occurredAt: Date }): string {
  const what = r.kind === "BAD_REVIEW" ? `отзыв ★${r.stars}`
    : r.kind === "REVIEW_FIXED" ? `отзыв исправлен ★${r.starsBefore}→★${r.stars}`
    : r.kind === "REVIEW_DELETED" ? `плохой отзыв ★${r.stars} удалён`
    : r.kind === "CLAIM_OPENED" ? "заявка на возврат" : "WB вернул деньги";
  return `${what} по заказу ${r.wbCode} (${new Date(r.occurredAt).toISOString().slice(0, 10)})${r.text ? `: «${r.text.slice(0, 120)}»` : ""}`;
}

export interface SupportCustomer {
  context: string;
  orders: Array<PaAiOrder & { heldReason?: string | null }>;
  /** Покупки кодов Robux (18.11.2026) — для строки карточки, когда заказов WB нет. */
  codeOrders: string[];
}

/**
 * Контекст по профилю (`userId`) или по конкретным кодам заказов (чат WB знает
 * заказ, но не профиль). Без внутренних причин заморозки.
 */
export async function loadSupportCustomer(
  db: Db,
  who: { userId?: string | null; wbCodes?: string[]; name: string | null },
): Promise<SupportCustomer> {
  // + заказы, к которым профиль подключён с другого аккаунта (`OrderContact`, 17.11.2026).
  const where = who.userId
    ? { OR: [{ userId: who.userId }, { contacts: { some: { userId: who.userId, removedAt: null } } }] }
    : who.wbCodes?.length ? { wbCode: { in: who.wbCodes } } : null;
  const rows: Array<PaAiOrder & { heldReason?: string | null; userId?: string; contacts?: Array<{ via: string }> }> = where
    ? await db.wbOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          wbCode: true, amount: true, status: true, createdAt: true, completedAt: true, heldAt: true, heldReason: true,
          robloxUsername: true, gamepassUrl: true, isDirectOrder: true, userId: true,
          ...(who.userId ? { contacts: { where: { userId: who.userId, removedAt: null }, select: { via: true } } } : {}),
        },
      }).catch(() => [])
    : [];
  // Подключённому по нику или пассу код заказа не называем: ник публичный.
  const orders: SupportCustomer["orders"] = rows.map(({ userId, contacts, ...o }) => {
    const watchedVia = who.userId && userId !== who.userId ? contacts?.[0]?.via : undefined;
    return watchedVia && !CODE_VIAS.includes(watchedVia) ? { ...o, wbCode: "скрыт — подключён по нику, код не называть" } : o;
  });
  const wbNotes = orders.length
    ? (await db.riskEvent.findMany({
        where: { wbCode: { in: rows.map((o) => o.wbCode) }, ...NOT_FOREIGN_REVIEW, kind: { in: RISK_KINDS } },
        orderBy: { occurredAt: "desc" }, take: 5,
        select: { kind: true, wbCode: true, stars: true, starsBefore: true, text: true, occurredAt: true },
      }).catch(() => [])).map(riskLine)
    : [];
  // 🎟 Покупки кодов Robux (18.11.2026): раньше ИИ их не видел и отвечал «заказов нет».
  const codeOrders: string[] = who.userId
    ? (await db.codeOrder.findMany({
        where: {
          status: { in: ["PAID", "ISSUED"] }, refundedAt: null,
          OR: [{ creatorUserId: who.userId }, { contacts: { some: { userId: who.userId, removedAt: null } } }],
        },
        orderBy: { createdAt: "desc" }, take: 3,
        select: { denomination: true, status: true, createdAt: true, issuedAt: true },
      }).catch(() => [])).map((o: { denomination: number; status: string; createdAt: Date; issuedAt: Date | null }) =>
        codeOrderContextLine({ amount: o.denomination, status: o.status, createdAt: o.createdAt, issuedAt: o.issuedAt }))
    : [];
  const known = Boolean(who.userId) || orders.length > 0;
  return { context: customerContext({ name: who.name, known, orders, wbNotes, codeOrders }), orders, codeOrders };
}
