import type { PrismaClient } from "@prisma/client";
import { sendBuyerChatMessage } from "./wb-delivery-api";
import { decryptWbSecret } from "./wb-delivery-crypto";
import {
  wbAutoReceiveWithinWindow,
  wbDeliverySecretIsLive,
  wbOrderAgeHours,
} from "./wb-delivery-policy";
import { wbCancelAcceptedMessage, wbCancelResumedMessage } from "./wb-gate-link";
import {
  notifyDbsCancelRequested,
  notifyDbsCancelResumed,
  notifyDbsCancelTooLate,
  notifyDbsCodeCaptured,
} from "./wb-delivery-admin-notify";
import { holdByCode, releaseByCode } from "./order-hold";
import { dbsRef, refreshDbsCard } from "./wb-dbs-thread";

/* ─────────────────────────────────────────────────────────────────────────────
   Режим отмены DBS-заказа (27.10.2026).

   Отказ на WB оформляется кодом доставки покупателя — тем же кодом, которым
   бот закрывает доставку. Поэтому раньше для отмены просили прислать код
   скрином или «зашифрованным», чтобы бот его не распознал и не закрыл заказ.

   Теперь у заказа есть флажок `cancelRequestedAt`. Пока он стоит, код доставки
   распознаётся как обычно, но НЕ уходит в WB — бот приносит его оператору, и
   тот отклоняет заказ в кабинете WB. Включается словом «отмена» в чате WB
   (покупатель может вернуть словом «продолжить») или кнопкой в TWA / на сайте
   (вернуть может только оператор).

   Доставку, которая уже закрыта, этот режим не трогает: там кодом ничего не
   сделать, остаётся возврат через WB, и оператора об этом предупреждают.
   ───────────────────────────────────────────────────────────────────────── */

type Db = PrismaClient;

export const WB_CANCEL_BY_BUYER = "buyer";
const HOLD_REASON = "Отмена заказа WB";

export type WbCancelIntent = "cancel" | "resume" | null;

/* `\b` в JS не видит кириллицу, поэтому граница слова — «не буква». */
const RESUME_RE = /(?:^|[^\p{L}])(?:продолж|не\s+(?:надо\s+|нужно\s+|хочу\s+)?(?:отмен|отказ))/iu;
const CANCEL_RE = /(?:^|[^\p{L}])(?:отмен|отказ|передумал|верн(?:ите|уть)\s+(?:мне\s+)?(?:деньги|средства)|возврат\s+(?:денег|средств))/iu;

/** Что покупатель хочет сказать про отмену. Отрицание («не отменяйте»)
 * читается как «продолжить» — проверяется первым. */
export function detectWbCancelIntent(text: string): WbCancelIntent {
  const clean = text.trim();
  if (!clean) return null;
  if (RESUME_RE.test(clean)) return "resume";
  if (CANCEL_RE.test(clean)) return "cancel";
  return null;
}

async function note(db: Db, orderId: string, type: string, key: string, actor: string, payload: Record<string, string | boolean | null>) {
  await db.wbMarketplaceEvent.upsert({
    where: { idempotencyKey: key },
    create: { marketplaceOrderId: orderId, type, idempotencyKey: key, actor, payload },
    update: {},
  }).catch(() => {});
}

async function sendToBuyer(
  order: { isTest: boolean; chats: Array<{ replySignEncrypted: string | null }> },
  text: string,
): Promise<boolean> {
  if (order.isTest) return true;
  if (process.env.WB_CHAT_SEND_ENABLED !== "true") return false;
  const sign = order.chats[0]?.replySignEncrypted;
  if (!sign) return false;
  try {
    await sendBuyerChatMessage(decryptWbSecret(sign, "reply-sign"), text);
    return true;
  } catch (error) {
    console.error("[wb-cancel] сообщение покупателю не ушло:", (error as { code?: string })?.code ?? error);
    return false;
  }
}

function loadOrder(db: Db, orderId: string) {
  return db.wbMarketplaceOrder.findUnique({
    where: { id: orderId },
    include: {
      deliverySecret: true,
      wbCode: { select: { code: true } },
      chats: { orderBy: { lastEventAt: "desc" as const }, take: 1 },
    },
  });
}

function liveCode(secret: Parameters<typeof wbDeliverySecretIsLive>[0] & { encryptedValue: string } | null): string | null {
  if (!secret || !wbDeliverySecretIsLive(secret)) return null;
  try {
    return decryptWbSecret(secret.encryptedValue, "delivery-code");
  } catch {
    return null;
  }
}

export type WbCancelResult =
  | { ok: true; already: boolean; hasCode: boolean; askedBuyer: boolean }
  | { ok: false; error: string; code: "NOT_FOUND" | "ALREADY_CANCELLED" | "DELIVERY_CLOSED" };

/** Включить режим отмены. Идемпотентно: повторное «отмена» ничего не шлёт. */
export async function requestWbOrderCancel(
  db: Db,
  input: { orderId: string; actor: string; buyerMessage?: string | null },
): Promise<WbCancelResult> {
  const order = await loadOrder(db, input.orderId);
  if (!order) return { ok: false, error: "Заказ не найден", code: "NOT_FOUND" };
  if (order.cancelledAt) return { ok: false, error: "Заказ уже отменён на WB", code: "ALREADY_CANCELLED" };
  if (order.completedAt) {
    if (input.actor === WB_CANCEL_BY_BUYER && input.buyerMessage) {
      notifyDbsCancelTooLate(await dbsRef(db, order.id, order.wbOrderId), input.buyerMessage);
    }
    return {
      ok: false,
      error: "Доставка уже закрыта на WB — отменить кодом нельзя, только возврат через WB",
      code: "DELIVERY_CLOSED",
    };
  }

  const now = new Date();
  const claimed = await db.wbMarketplaceOrder.updateMany({
    where: { id: order.id, cancelRequestedAt: null, completedAt: null, cancelledAt: null },
    data: { cancelRequestedAt: now, cancelRequestedBy: input.actor },
  });
  const code = liveCode(order.deliverySecret);
  if (claimed.count !== 1) return { ok: true, already: true, hasCode: Boolean(code), askedBuyer: false };

  await note(db, order.id, "CANCEL_REQUESTED", `cancel:${order.id}:${now.getTime()}`, input.actor, {
    by: input.actor === WB_CANCEL_BY_BUYER ? "buyer" : "operator",
    hasCode: Boolean(code),
  });

  // Гейт мог уйти раньше (ручная выдача) — его нельзя оставлять рабочим.
  let buyoutDone = false;
  if (order.wbCode?.code) {
    await holdByCode(db, { wbCode: order.wbCode.code, reason: HOLD_REASON, actor: input.actor === WB_CANCEL_BY_BUYER ? "покупатель (чат WB)" : input.actor })
      .catch(() => {});
    const buyout = await db.wbOrder.findUnique({ where: { wbCode: order.wbCode.code }, select: { status: true } }).catch(() => null);
    buyoutDone = buyout?.status === "COMPLETED";
  }

  const byBuyer = input.actor === WB_CANCEL_BY_BUYER;
  const askedBuyer = await sendToBuyer(order, wbCancelAcceptedMessage({ hasCode: Boolean(code), byBuyer }));
  notifyDbsCancelRequested(await dbsRef(db, order.id, order.wbOrderId), {
    by: input.actor,
    deliveryCode: code,
    buyerMessage: input.buyerMessage ?? null,
    buyoutDone,
    askedBuyer,
  });
  await refreshDbsCard(db, order.id).catch(() => {});
  return { ok: true, already: false, hasCode: Boolean(code), askedBuyer };
}

export type WbResumeResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: string; code: "NOT_FOUND" | "NOT_IN_CANCEL" };

/** Снять режим отмены. Покупатель снимает только свою отмену — отмену,
 * включённую оператором, словом «продолжить» не перебить. */
export async function resumeWbOrderCancel(
  db: Db,
  input: { orderId: string; actor: string },
): Promise<WbResumeResult> {
  const order = await loadOrder(db, input.orderId);
  if (!order) return { ok: false, error: "Заказ не найден", code: "NOT_FOUND" };
  const byBuyer = input.actor === WB_CANCEL_BY_BUYER;
  const cleared = await db.wbMarketplaceOrder.updateMany({
    where: {
      id: order.id,
      cancelRequestedAt: { not: null },
      cancelledAt: null,
      ...(byBuyer ? { cancelRequestedBy: WB_CANCEL_BY_BUYER } : {}),
    },
    data: { cancelRequestedAt: null, cancelRequestedBy: null },
  });
  if (cleared.count !== 1) {
    return byBuyer
      ? { ok: true, changed: false }
      : { ok: false, error: "Заказ не в режиме отмены", code: "NOT_IN_CANCEL" };
  }
  await note(db, order.id, "CANCEL_RESUMED", `cancel-resume:${order.id}:${Date.now()}`, input.actor, {
    by: byBuyer ? "buyer" : "operator",
  });

  // Снимаем только свою заморозку: чужая причина (гейт выкупа, проверка) остаётся.
  if (order.wbCode?.code) {
    const hold = await db.orderHold.findUnique({ where: { wbCode: order.wbCode.code }, select: { reason: true, releasedAt: true } }).catch(() => null);
    if (hold && !hold.releasedAt && hold.reason === HOLD_REASON) {
      await releaseByCode(db, { wbCode: order.wbCode.code, actor: byBuyer ? "покупатель (чат WB)" : input.actor }).catch(() => {});
    }
  }

  const code = liveCode(order.deliverySecret);
  if (byBuyer) await sendToBuyer(order, wbCancelResumedMessage(Boolean(code)));
  const ref = await dbsRef(db, order.id, order.wbOrderId);
  notifyDbsCancelResumed(ref, input.actor);
  // Код у нас, но окно автозакрытия прошло — закрывать будет человек, и без
  // этого сообщения код просто пролежал бы до истечения.
  if (code && order.deliverySecret && !wbAutoReceiveWithinWindow(order, order.deliverySecret.receivedAt)) {
    notifyDbsCodeCaptured(ref, "order_too_old", {
      deliveryCode: code,
      ageHours: wbOrderAgeHours(order, order.deliverySecret.receivedAt),
    });
  }
  await refreshDbsCard(db, order.id).catch(() => {});
  return { ok: true, changed: true };
}
