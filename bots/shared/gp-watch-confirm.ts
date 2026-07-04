/**
 * Shared GP-watcher confirmation logic (+3), used by both TG and VK handlers so
 * the "✅ this is mine / ❌ not my nick" buttons behave identically.
 *
 * Lives in shared/ (imports only shared modules) to avoid a tg↔vk↔auto-workers
 * import cycle. The auto-worker detects the gamepass and pings the user; these
 * functions run when the user answers.
 */
import { db } from "./db";
import { ADMIN_IDS } from "./admin";
import { tgSend, escapeHtml } from "./notify";
import { searchGamepassesByNick } from "./gamepass-search";

const expectedPrice = (amount: number) => Math.ceil(amount / 0.7);

export type GpWatchConfirmResult =
  | { status: "ok"; passName: string; robux: number; nick: string; wbCode: string }
  | { status: "already" }        // order already moved on (manager/user handled it)
  | { status: "gone" }           // the gamepass is no longer for sale at the right price
  | { status: "error" };

/**
 * User tapped "✅ Да, это мой". Re-validate the gamepass live, then promote the
 * order to PENDING with the (now confirmed) nick so the buyout picks it up.
 */
export async function confirmGpWatch(orderId: string): Promise<GpWatchConfirmResult> {
  try {
    const order = await (db as any).wbOrder.findUnique({
      where: { id: orderId },
      select: { id: true, wbCode: true, amount: true, status: true, probableNick: true },
    });
    if (!order) return { status: "error" };
    if (order.status !== "AWAITING_GAMEPASS" || !order.probableNick) return { status: "already" };

    const want = expectedPrice(order.amount);
    const outcome = await searchGamepassesByNick(order.probableNick, want);
    if (outcome.status !== "ok" || outcome.matches.length === 0) return { status: "gone" };
    const pass = outcome.matches[0];

    // Atomic promotion — guards against the manager attaching a gamepass first.
    const claim = await (db as any).wbOrder.updateMany({
      where: { id: order.id, status: "AWAITING_GAMEPASS" },
      data: {
        status: "PENDING",
        pendingAt: new Date(),
        gamepassUrl: `https://www.roblox.com/game-pass/${pass.gamepassId}`,
        robloxUsername: order.probableNick, // now confirmed by the customer → authoritative
        rejectionReason: null,
      },
    });
    if (claim.count === 0) return { status: "already" };

    await Promise.allSettled(ADMIN_IDS.map((id) => tgSend(id,
      `👁 <b>GP-WATCH подтверждён</b> · <code>${order.wbCode}</code>\n` +
      `Ник: <b>${escapeHtml(order.probableNick)}</b> · геймпасс <b>${escapeHtml(pass.name)}</b> · ${pass.robux} R$\n` +
      `Заказ → PENDING (в очереди «К выкупу»).`,
      { parse_mode: "HTML" })));

    return { status: "ok", passName: pass.name, robux: pass.robux, nick: order.probableNick, wbCode: order.wbCode };
  } catch (err: any) {
    console.error("[gp-watch] confirm error:", err?.message ?? err);
    return { status: "error" };
  }
}

/** User tapped "❌ Не мой ник". Stop watching until they enter a nick again. */
export async function declineGpWatch(orderId: string): Promise<void> {
  try {
    const order = await (db as any).wbOrder.findUnique({ where: { id: orderId }, select: { adminNote: true, status: true } });
    if (!order || order.status !== "AWAITING_GAMEPASS") return;
    const stamp = new Date().toISOString().slice(0, 10);
    const prefix = order.adminNote ? `${order.adminNote}\n` : "";
    await (db as any).wbOrder.update({
      where: { id: orderId },
      data: {
        probableNick: null,
        gpWatchNotifiedPassId: null,
        adminNote: `${prefix}[НИК-ОТКАЗ ${stamp}] юзер отклонил GP-watch`.slice(0, 2000),
      },
    });
  } catch (err: any) {
    console.error("[gp-watch] decline error:", err?.message ?? err);
  }
}
