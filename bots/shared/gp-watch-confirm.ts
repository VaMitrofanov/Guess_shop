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
import { assertOwnsOrder, type Actor } from "./ownership";

const expectedPrice = (amount: number) => Math.ceil(amount / 0.7);

export type GpWatchConfirmResult =
  | { status: "ok"; passName: string; robux: number; nick: string; wbCode: string }
  | { status: "already" }        // order already moved on (manager/user handled it)
  | { status: "gone" }           // the gamepass is no longer for sale at the right price
  | { status: "forbidden" }      // U6: кнопка нажата не владельцем заказа
  | { status: "error" };

/**
 * User tapped "✅ Да, это мой". Re-validate the gamepass live, then promote the
 * order to PENDING with the (now confirmed) nick so the buyout picks it up.
 */
export async function confirmGpWatch(orderId: string, actor: Actor): Promise<GpWatchConfirmResult> {
  try {
    // U6: заказ читается только вместе с проверкой владельца — `callback_data`
    // подделывается, и раньше по чужому ID *предположительный* ник записывался
    // как подтверждённый клиентом и уходил в очередь на реальный выкуп.
    const owned = await assertOwnsOrder<{
      id: string; wbCode: string; amount: number; status: string; probableNick: string | null;
    }>(actor, orderId, { id: true, wbCode: true, amount: true, status: true, probableNick: true });
    if (!owned.ok) return { status: owned.reason === "forbidden" ? "forbidden" : "error" };
    const order = owned.entity;
    const probableNick = order.probableNick;
    if (order.status !== "AWAITING_GAMEPASS" || !probableNick) return { status: "already" };

    const want = expectedPrice(order.amount);
    const outcome = await searchGamepassesByNick(probableNick, want);
    if (outcome.status !== "ok" || outcome.matches.length === 0) return { status: "gone" };
    const pass = outcome.matches[0];

    // Atomic promotion — guards against the manager attaching a gamepass first.
    const claim = await (db as any).wbOrder.updateMany({
      where: { id: order.id, status: "AWAITING_GAMEPASS" },
      data: {
        status: "PENDING",
        pendingAt: new Date(),
        gamepassUrl: `https://www.roblox.com/game-pass/${pass.gamepassId}`,
        robloxUsername: probableNick, // now confirmed by the customer → authoritative
        rejectionReason: null,
      },
    });
    if (claim.count === 0) return { status: "already" };

    await Promise.allSettled(ADMIN_IDS.map((id) => tgSend(id,
      `👁 <b>GP-WATCH подтверждён</b> · <code>${order.wbCode}</code>\n` +
      `Ник: <b>${escapeHtml(probableNick)}</b> · геймпасс <b>${escapeHtml(pass.name)}</b> · ${pass.robux} R$\n` +
      `Заказ → PENDING (в очереди «К выкупу»).`,
      { parse_mode: "HTML" })));

    return { status: "ok", passName: pass.name, robux: pass.robux, nick: probableNick, wbCode: order.wbCode };
  } catch (err: any) {
    console.error("[gp-watch] confirm error:", err?.message ?? err);
    return { status: "error" };
  }
}

/**
 * User tapped "❌ Не мой ник". Stop watching until they enter a nick again.
 * Returns the order's code/amount so callers can arm the nick-input state
 * («пришли свой ник сюда» must actually route into the nick search — П2).
 */
export async function declineGpWatch(
  orderId: string,
  actor: Actor,
): Promise<{ wbCode: string; amount: number } | null> {
  try {
    // U6: та же проверка владельца — иначе чужому заказу стирается probableNick.
    const owned = await assertOwnsOrder<{
      adminNote: string | null; status: string; wbCode: string; amount: number; probableNick: string | null;
    }>(actor, orderId, { adminNote: true, status: true, wbCode: true, amount: true, probableNick: true });
    if (!owned.ok) return null;
    const order = owned.entity;
    if (order.status !== "AWAITING_GAMEPASS") return null;
    const stamp = new Date().toISOString().slice(0, 10);
    const prefix = order.adminNote ? `${order.adminNote}\n` : "";
    await (db as any).wbOrder.update({
      where: { id: orderId },
      data: {
        probableNick: null,
        gpWatchNotifiedPassId: null,
        // П3: структурный маркер отказа — бейдж в TWA, надёжнее парсинга adminNote.
        gpWatchDeclinedAt: new Date(),
        adminNote: `${prefix}[НИК-ОТКАЗ ${stamp}] юзер отклонил GP-watch`.slice(0, 2000),
      },
    });
    // П3: менеджер должен узнать об отказе сразу (симметрично алерту «нашёл ГП»).
    await Promise.allSettled(ADMIN_IDS.map((id) => tgSend(id,
      `❌ <b>GP-watch: клиент отверг ник</b> · <code>${order.wbCode}</code>\n` +
      (order.probableNick ? `Предложенный ник: <b>${escapeHtml(order.probableNick)}</b>\n` : "") +
      `Бот попросил прислать правильный ник; заказ помечен бейджем в TWA («Ждут ссылку»).`,
      { parse_mode: "HTML" })));
    return { wbCode: order.wbCode, amount: order.amount };
  } catch (err: any) {
    console.error("[gp-watch] decline error:", err?.message ?? err);
    return null;
  }
}
