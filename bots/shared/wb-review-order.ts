/* ─────────────────────────────────────────────────────────────────────────────
   ⭐ Чей это отзыв (27.11.2026, владелец: «напротив отзыва — номер заказа
   (копируемый) и данные по заказу, чтобы было видно, кто это»).

   Та же привязка, что у гейта выкупа (`attributeFeedbacks`): WB кладёт в отзыв
   `lastOrderCreatedAt` — момент заказа автора, задание DBS появляется через
   0–8 минут после него. Ближайшее задание того же товара в окне — его заказ.
   ───────────────────────────────────────────────────────────────────────── */

import { attributeFeedbacks, reviewOrderTime, REVIEW_ORDER_WINDOW_MS, type WbFeedback } from "./buyout-gate";
import { identityLinesFor } from "./buyer-identity";
import { escapeHtml } from "./notify";
import { orderStatusWord } from "./notify-format";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface ReviewOrderInfo {
  /** Готовые строки для уведомления (HTML). */
  lines: string[];
  /** Код нашего заказа, если нашёлся. */
  code: string | null;
  /** Данные для ИИ: этап заказа простыми словами. */
  context: string;
}

const msk = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const t = new Date(d);
  if (!Number.isFinite(t.getTime())) return null;
  return new Date(t.getTime() + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ").replace(/^(\d{4})-(\d\d)-(\d\d)/, "$3.$2") + " МСК";
};

export async function reviewOrderInfo(db: Db, fb: WbFeedback & { lastOrderShkId?: number | string | null }): Promise<ReviewOrderInfo> {
  const at = reviewOrderTime(fb);
  const shk = fb.lastOrderShkId ? `ШК <code>${escapeHtml(String(fb.lastOrderShkId))}</code>` : null;
  const ordered = at ? `заказ на WB ${msk(new Date(at))}` : null;
  const none = (why: string): ReviewOrderInfo => ({
    lines: [`📦 ${why}${[ordered, shk].filter(Boolean).length ? ` · ${[ordered, shk].filter(Boolean).join(" · ")}` : ""}`],
    code: null,
    context: "Заказ этого покупателя в нашей базе не найден.",
  });
  if (at === null) return none("заказ не определить: WB не дал время заказа");

  const rows = await db.wbMarketplaceOrder.findMany({
    where: {
      OR: [
        { wbCreatedAt: { gte: new Date(at - REVIEW_ORDER_WINDOW_MS.before), lte: new Date(at + REVIEW_ORDER_WINDOW_MS.after) } },
        { wbCreatedAt: null, firstSeenAt: { gte: new Date(at - REVIEW_ORDER_WINDOW_MS.before), lte: new Date(at + REVIEW_ORDER_WINDOW_MS.after) } },
      ],
    },
    select: { id: true, nmId: true, wbOrderId: true, wbCreatedAt: true, firstSeenAt: true, buyerName: true, claimOpenedAt: true, cancelledAt: true, wbCode: { select: { code: true } } },
    take: 200,
  }).catch(() => []);
  const one = [{ ...fb }];
  attributeFeedbacks(one, rows.map((r: { nmId: number | null; wbCreatedAt: Date | null; firstSeenAt: Date; buyerName: string | null; wbCode: { code: string } | null }) => ({
    code: r.wbCode?.code ?? null, nmId: r.nmId ?? null, at: r.wbCreatedAt ?? r.firstSeenAt, buyerName: r.buyerName ?? null,
  })));
  const code = one[0].orderCodes?.[0] ?? null;
  const mp = code ? rows.find((r: { wbCode: { code: string } | null }) => r.wbCode?.code === code) : null;
  if (!code || !mp) return none("заказ в нашей базе не найден");

  const order = await db.wbOrder.findUnique({
    where: { wbCode: code },
    select: { amount: true, status: true, completedAt: true, robloxUsername: true, heldAt: true },
  }).catch(() => null);
  const status = order ? orderStatusWord(order.status) : "код ещё не вводил";
  const who = await identityLinesFor(db, mp.id, { short: true });
  // Владелец 27.11.2026: главное — копируемый код, статус и дата; остальное — по мере места.
  const head = order?.completedAt ? `выкуплен ${msk(order.completedAt)}` : `${status}${ordered ? ` · ${ordered}` : ""}`;
  const lines = [
    `📦 <code>${escapeHtml(code)}</code> · <b>${escapeHtml(head)}</b>${order?.heldAt ? " ❄️" : ""}${mp.claimOpenedAt ? " · ↩ возврат" : ""}${mp.cancelledAt ? " · отменён" : ""}`,
    [order ? `${order.amount} R$` : null, `WB #<code>${escapeHtml(mp.wbOrderId)}</code>`, order?.robloxUsername ? `ник <code>${escapeHtml(order.robloxUsername)}</code>` : null, shk]
      .filter(Boolean).join(" · "),
    ...who,
  ].filter(Boolean);
  const context = [
    `Заказ ${code}: ${order ? `${order.amount} R$, ${status}` : "покупатель ещё не вводил код заказа"}`,
    order?.completedAt ? `выкуплен ${msk(order.completedAt)}` : null,
    mp.claimOpenedAt ? "по заказу открыта заявка на возврат на WB" : null,
    mp.cancelledAt ? "заказ отменён на WB, деньги вернулись" : null,
  ].filter(Boolean).join("; ");
  return { lines, code, context };
}
