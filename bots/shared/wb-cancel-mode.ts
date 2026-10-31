import type { PrismaClient } from "@prisma/client";
import { sendBuyerChatMessage } from "./wb-delivery-api";
import { decryptWbSecret } from "./wb-delivery-crypto";
import {
  wbAutoReceiveWithinWindow,
  wbDeliverySecretIsLive,
  wbOrderAgeHours,
} from "./wb-delivery-policy";
import { wbCancelAcceptedMessage } from "./wb-gate-link";
import {
  notifyDbsCancelRequested,
  notifyDbsCancelResumed,
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
   тот отклоняет заказ в кабинете WB.

   Включает и снимает режим ТОЛЬКО оператор (решение владельца 27.10.2026):
   сообщением из кабинета WB, начинающимся с «Отмена…» / «Продолжаем…», или
   кнопкой в TWA / на сайте. Слова покупателя («отмените», «передумал») режим
   не трогают — это обычное сообщение оператору.

   Доставку, которая уже закрыта, этот режим не трогает: там кодом ничего не
   сделать, остаётся возврат через WB, и оператора об этом предупреждают.
   ───────────────────────────────────────────────────────────────────────── */

type Db = PrismaClient;

/** Оператор включил отмену своим сообщением из кабинета WB. */
export const WB_CANCEL_BY_SELLER_CHAT = "чат WB";
const HOLD_REASON = "Отмена заказа WB";

export type WbCancelIntent = "cancel" | "resume" | null;

/* Команда оператора из кабинета WB — сообщение продавца, которое НАЧИНАЕТСЯ
   со слова: «Отмена…», «Оформляем отмену…» / «Продолжаем…», «Отмена снята…».
   Только начало строки: бот сам пишет в тот же чат («Приняли запрос на
   отмену…», «Хорошо, заказ не отменяем…»), и его сообщения возвращаются
   в ленту тоже от имени продавца. Ни одно из них так не начинается — это
   закреплено тестом. */
const OPERATOR_RESUME_RE = /^\s*(?:продолж|отмена\s+снята|снимаем\s+отмен)/iu;
const OPERATOR_CANCEL_RE = /^\s*(?:отмен|оформля(?:ем|ю)\s+отмен|оформим\s+отмен)/iu;

export function detectWbOperatorCommand(text: string): WbCancelIntent {
  if (OPERATOR_RESUME_RE.test(text)) return "resume";
  if (OPERATOR_CANCEL_RE.test(text)) return "cancel";
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
  input: {
    orderId: string;
    actor: string;
    /** Оператор уже сам написал покупателю — своё сообщение бот не шлёт. */
    silent?: boolean;
  },
): Promise<WbCancelResult> {
  const order = await loadOrder(db, input.orderId);
  if (!order) return { ok: false, error: "Заказ не найден", code: "NOT_FOUND" };
  if (order.cancelledAt) return { ok: false, error: "Заказ уже отменён на WB", code: "ALREADY_CANCELLED" };
  if (order.completedAt) {
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
    by: input.actor,
    hasCode: Boolean(code),
  });

  // Гейт мог уйти раньше (ручная выдача) — его нельзя оставлять рабочим.
  let buyoutDone = false;
  if (order.wbCode?.code) {
    await holdByCode(db, { wbCode: order.wbCode.code, reason: HOLD_REASON, actor: input.actor })
      .catch(() => {});
    const buyout = await db.wbOrder.findUnique({ where: { wbCode: order.wbCode.code }, select: { status: true } }).catch(() => null);
    buyoutDone = buyout?.status === "COMPLETED";
  }

  const askedBuyer = input.silent
    ? true
    : await sendToBuyer(order, wbCancelAcceptedMessage({ hasCode: Boolean(code) }));
  notifyDbsCancelRequested(await dbsRef(db, order.id, order.wbOrderId), {
    by: input.actor,
    deliveryCode: code,
    buyoutDone,
    askedBuyer,
  });
  await refreshDbsCard(db, order.id).catch(() => {});
  return { ok: true, already: false, hasCode: Boolean(code), askedBuyer };
}

export type WbResumeResult =
  | { ok: true; changed: true }
  | { ok: false; error: string; code: "NOT_FOUND" | "NOT_IN_CANCEL" };

/** Снять режим отмены (только оператор). Покупателю бот ничего не пишет:
 * оператор либо уже написал сам из кабинета, либо напишет. */
export async function resumeWbOrderCancel(
  db: Db,
  input: { orderId: string; actor: string },
): Promise<WbResumeResult> {
  const order = await loadOrder(db, input.orderId);
  if (!order) return { ok: false, error: "Заказ не найден", code: "NOT_FOUND" };
  const cleared = await db.wbMarketplaceOrder.updateMany({
    where: {
      id: order.id,
      cancelRequestedAt: { not: null },
      cancelledAt: null,
    },
    data: { cancelRequestedAt: null, cancelRequestedBy: null },
  });
  if (cleared.count !== 1) return { ok: false, error: "Заказ не в режиме отмены", code: "NOT_IN_CANCEL" };
  await note(db, order.id, "CANCEL_RESUMED", `cancel-resume:${order.id}:${Date.now()}`, input.actor, {
    by: input.actor,
  });

  // Снимаем только свою заморозку: чужая причина (гейт выкупа, проверка) остаётся.
  if (order.wbCode?.code) {
    const hold = await db.orderHold.findUnique({ where: { wbCode: order.wbCode.code }, select: { reason: true, releasedAt: true } }).catch(() => null);
    if (hold && !hold.releasedAt && hold.reason === HOLD_REASON) {
      await releaseByCode(db, { wbCode: order.wbCode.code, actor: input.actor }).catch(() => {});
    }
  }

  const code = liveCode(order.deliverySecret);
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
