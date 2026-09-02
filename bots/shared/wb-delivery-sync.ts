import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { generateWbActivationCode } from "./wb-activation-code";
import {
  wbCodeRequestMessage,
  wbCodeRecheckMessage,
  wbCodeRetryMessage,
  wbGateMessage,
  wbGateReminderMessage,
  wbSiblingPosition,
  type WbOrderSibling,
} from "./wb-gate-link";
import {
  assertBulkOrderSucceeded,
  confirmDbsOrder,
  deliverDbsOrder,
  fetchBuyerChatEvents,
  fetchBuyerChats,
  fetchCompletedDbsOrders,
  fetchDbsClients,
  fetchDbsDeliveryDates,
  fetchDbsStatuses,
  fetchNewDbsOrders,
  receiveDbsOrder,
  sendBuyerChatMessage,
  WbDeliveryApiError,
} from "./wb-delivery-api";
import {
  deliveryWindow,
  safeDate,
  wbBuyerName,
  wbChatClientName,
  wbClientOrderId,
  type WbChat,
  type WbChatEvent,
  type WbDbsOrder,
} from "./wb-delivery-contract";
import {
  decryptWbSecret,
  encryptWbSecret,
  extractDeliveryCode,
  redactWbChatText,
  wbDeliveryCryptoReady,
  wbSecretHmac,
} from "./wb-delivery-crypto";
import {
  canAutoRejectInternalOrder,
  canCaptureDeliveryCode,
  canReceiveWbOrder,
  canSendWbGate,
  shouldMarkCodeRequested,
  wbAutoReceiveWithinWindow,
  wbAutoShipAction,
  wbDeliverySecretIsLive,
  wbMarketplaceTerminalFlags,
  wbOrderAgeHours,
  wbProductVendorCandidates,
  wbReceiveRetryCutoff,
  wbReceiveRetryDue,
  wbReceiveRetryDueAt,
  wbReceiveRetriesExhausted,
  WB_RECEIVE_MAX_ATTEMPTS,
  WB_RECEIVE_RECHECK_AFTER_ATTEMPTS,
  WB_RECEIVE_RETRY_HORIZON_MS,
} from "./wb-delivery-policy";
import {
  notifyDbsBuyerMessage,
  notifyDbsCodeCaptured,
  notifyDbsCodeRecheck,
  notifyDbsCodeRejected,
  notifyDbsAutoReceiveFailed,
  notifyDbsOrderCancelled,
  notifyDbsDeliveryStuck,
  notifyDbsGateNotOpened,
} from "./wb-delivery-admin-notify";
// Живая карточка вынесена в свой модуль: её читают и воркер, и VK-бот, и сайт,
// а воркер тянет `wb-delivery-api` с `zod`, которого в образе VK-бота нет.
import { dbsRef, refreshDbsCard } from "./wb-dbs-thread";

const WORKER_STREAM = "wb-dbs-worker";
const EVENTS_STREAM = "wb-buyer-chat-events";
const CHATS_STREAM = "wb-buyer-chats";
const STATUSES_STREAM = "wb-dbs-statuses";
const RECHECK_STREAM = "wb-dbs-closed-recheck";
const COMPLETED_STREAM = "wb-dbs-completed";
const CLIENTS_STREAM = "wb-dbs-clients";
const REMINDERS_STREAM = "wb-dbs-gate-reminders";
const HEARTBEAT_KEY = "wb-dbs-sync";
const LEASE_MS = 45_000;
/** How far back a closed order is still re-checked for a late cancellation or
 * return. WB refunds land within days, and the window bounds the poll cost. */
const CLOSED_RECHECK_DAYS = 14;
/** How long a held delivery code may sit unclosed before the operator is told.
 * WB's own window is about an hour, so this leaves room to act on the alert. */
const STUCK_DELIVERY_ALERT_MS = 20 * 60_000;
/** Э7: when a buyer who received a gate link still has not opened it. Two
 * nudges, then the order is the operator's problem rather than the bot's. */
const GATE_REMINDERS = [
  { level: 1, afterMs: 3 * 60 * 60_000 },
  { level: 2, afterMs: 24 * 60 * 60_000 },
] as const;

type Db = PrismaClient;

export type WbDeliverySyncResult = {
  acquired: boolean;
  newOrders: number;
  completedOrders: number;
  statuses: number;
  chats: number;
  chatEvents: number;
  capturedCodes: number;
  buyerNames: number;
  /** Orders WB cancelled since the previous cycle, mirrored into our own side. */
  cancellations: number;
  /** Orders pushed one step along WB's `new → confirm → deliver` ladder. */
  shipped: number;
  /** Nudges sent to buyers who never opened their gate link. */
  gateReminders: number;
  errorCode: string | null;
};

function result(acquired = false): WbDeliverySyncResult {
  return {
    acquired,
    newOrders: 0,
    completedOrders: 0,
    statuses: 0,
    chats: 0,
    chatEvents: 0,
    capturedCodes: 0,
    buyerNames: 0,
    cancellations: 0,
    shipped: 0,
    gateReminders: 0,
    errorCode: null,
  };
}

function safeErrorCode(error: unknown): string {
  if (error instanceof WbDeliveryApiError) {
    return `${error.scope.toUpperCase()}_${error.status}_${error.providerCode}`.slice(0, 160);
  }
  const prismaCode = (error as { code?: unknown } | null)?.code;
  if (typeof prismaCode === "string") return `DB_${prismaCode}`.slice(0, 160);
  return "INTERNAL_SYNC_ERROR";
}

function orderAmounts(order: WbDbsOrder) {
  const price = order.price ?? order.convertedPrice ?? order.salePrice;
  const finalPrice = order.finalPrice ?? order.convertedFinalPrice ?? order.salePrice;
  return {
    priceKopecks: Number.isFinite(price) ? Math.round(price as number) : null,
    finalPriceKopecks: Number.isFinite(finalPrice) ? Math.round(finalPrice as number) : null,
  };
}

async function touchCursor(db: Db, stream: string, data: Record<string, unknown> = {}) {
  await db.wbSyncCursor.upsert({
    where: { stream },
    create: { stream, ...data },
    update: data,
  });
}

async function streamDue(db: Db, stream: string, cadenceMs: number, force: boolean) {
  if (force) return true;
  const cursor = await db.wbSyncCursor.findUnique({
    where: { stream },
    select: { lastSuccessAt: true },
  });
  return !cursor?.lastSuccessAt || Date.now() - cursor.lastSuccessAt.getTime() >= cadenceMs;
}

async function acquireLease(db: Db) {
  const now = new Date();
  const leaseId = crypto.randomUUID();
  await db.wbSyncCursor.upsert({
    where: { stream: WORKER_STREAM },
    create: { stream: WORKER_STREAM },
    update: {},
  });
  const claimed = await db.wbSyncCursor.updateMany({
    where: {
      stream: WORKER_STREAM,
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    data: {
      leaseId,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      lastAttemptAt: now,
      lastErrorCode: null,
    },
  });
  return claimed.count === 1 ? leaseId : null;
}

async function releaseLease(db: Db, leaseId: string, errorCode: string | null) {
  await db.wbSyncCursor.updateMany({
    where: { stream: WORKER_STREAM, leaseId },
    data: {
      leaseId: null,
      leaseUntil: null,
      lastSuccessAt: errorCode ? undefined : new Date(),
      lastErrorCode: errorCode,
    },
  });
}

async function audit(
  db: Db,
  marketplaceOrderId: string,
  type: string,
  idempotencyKey: string,
  payload: Record<string, string | number | boolean | null>,
) {
  await db.wbMarketplaceEvent.upsert({
    where: { idempotencyKey },
    create: { marketplaceOrderId, type, idempotencyKey, actor: "wb-sync", payload },
    update: {},
  });
}

async function upsertMarketplaceOrder(
  db: Db,
  order: WbDbsOrder,
  dates?: { id: string; dDate: string | undefined; dTimeFrom: string | undefined; dTimeTo: string | undefined },
  source = "new",
) {
  const productByNmId = await db.wbProductCost.findUnique({
    where: { nmID: order.nmId },
    select: { denomination: true, vendorCode: true },
  });
  const vendorCandidates = wbProductVendorCandidates(order.article);
  const productByVendor = !productByNmId && vendorCandidates.length
    ? await db.wbProductCost.findFirst({
      where: { vendorCode: { in: vendorCandidates }, denomination: { not: null } },
      orderBy: { updatedAt: "desc" },
      select: { denomination: true, vendorCode: true },
    })
    : null;
  const product = productByNmId ?? productByVendor;
  const window = deliveryWindow(dates);
  const amounts = orderAmounts(order);
  const now = new Date();
  const { cancelled, completed } = wbMarketplaceTerminalFlags(order.supplierStatus, order.wbStatus);
  const lastErrorCode = product?.denomination ? null : "MISSING_DENOMINATION";
  // The order *card* endpoints (`/orders/new`, `/orders`) describe the goods,
  // not the state: `/orders` omits `supplierStatus` and `wbStatus` entirely.
  // Writing a placeholder there overwrote the real status the poller had
  // fetched, so status is only ever written when WB actually sent one.
  const wbSaidStatus = {
    ...(order.supplierStatus ? { supplierStatus: order.supplierStatus } : {}),
    ...(order.wbStatus ? { wbStatus: order.wbStatus } : {}),
  };
  // `createdAt` несёт только карточка заказа; фиды статусов и завершённых его
  // не отдают. Пустое значение обязано ничего не трогать — иначе каждый опрос
  // статусов стирал бы момент оформления, от которого считается окно
  // автозакрытия, и старый заказ снова выглядел бы свежим.
  const wbCreated = order.createdAt ? new Date(order.createdAt) : null;
  const wbSaidCreatedAt = wbCreated && !Number.isNaN(wbCreated.getTime())
    ? { wbCreatedAt: wbCreated }
    : {};
  const goods = {
    fulfillmentModel: "DBS",
    rid: order.rid,
    orderUid: order.orderUid,
    groupId: order.groupId,
    nmId: order.nmId,
    vendorCode: product?.vendorCode ?? order.article,
    article: order.article,
    denominationSnapshot: product?.denomination ?? null,
    ...amounts,
    currencyCode: order.convertedCurrencyCode ?? order.currencyCode,
    deliveryFrom: window.from,
    deliveryTo: window.to,
    requiredMeta: order.requiredMeta,
    lastErrorCode,
    lastSeenAt: now,
  };
  const record = await db.wbMarketplaceOrder.upsert({
    where: { wbOrderId: order.id },
    create: {
      wbOrderId: order.id,
      ...goods,
      ...wbSaidCreatedAt,
      supplierStatus: order.supplierStatus ?? "new",
      wbStatus: order.wbStatus ?? "waiting",
      completedAt: completed ? now : undefined,
      cancelledAt: cancelled ? now : undefined,
    },
    update: {
      ...goods,
      ...wbSaidStatus,
      ...wbSaidCreatedAt,
      ...(cancelled ? { cancelledAt: now, completedAt: null } : {}),
      ...(completed ? { completedAt: now } : {}),
    },
  });
  await audit(db, record.id, "ORDER_SYNCED", `order:${order.id}:${source}`, {
    source,
    supplierStatus: record.supplierStatus,
    wbStatus: record.wbStatus,
    mapped: Boolean(product?.denomination),
  });
  return record;
}

function chatOrderWhere(chat: WbChat) {
  const rid = chat.goodCard?.rid;
  return rid ? { rid } : null;
}

/** WB publishes the buyer's name on the chat, never on the DBS order. Storing
 * it the moment it appears is what lets an operator recognise the order that
 * matches a WB conversation instead of comparing eight-digit numbers.
 *
 * Written once and never overwritten: a name already on the order was seen
 * earlier and is just as good, and re-writing it on every cycle would churn
 * `updatedAt` and reshuffle the queue. */
async function rememberBuyerName(
  db: Db,
  order: { id: string; buyerName: string | null },
  clientName: string | undefined,
  out: WbDeliverySyncResult,
) {
  if (!clientName || order.buyerName) return;
  await db.wbMarketplaceOrder.update({ where: { id: order.id }, data: { buyerName: clientName } });
  order.buyerName = clientName;
  await audit(db, order.id, "BUYER_NAME_RESOLVED", `buyer-name:${order.id}`, { source: "chat" }).catch(() => {});
  out.buyerNames += 1;
}

async function syncChatDirectory(db: Db, out: WbDeliverySyncResult) {
  const response = await fetchBuyerChats();
  for (const chat of response.result) {
    const orderWhere = chatOrderWhere(chat);
    const order = orderWhere
      ? await db.wbMarketplaceOrder.findUnique({ where: orderWhere })
      : null;
    if (order) await rememberBuyerName(db, order, wbChatClientName(chat), out);
    const replySignEncrypted = chat.replySign && wbDeliveryCryptoReady()
      ? encryptWbSecret(chat.replySign, "reply-sign")
      : undefined;
    await db.wbBuyerChat.upsert({
      where: { chatId: chat.chatID },
      create: {
        chatId: chat.chatID,
        marketplaceOrderId: order?.id,
        replySignEncrypted,
      },
      update: {
        marketplaceOrderId: order?.id,
        ...(replySignEncrypted ? { replySignEncrypted } : {}),
      },
    });
    if (order && order.chatState === "WAITING_BUYER_CHAT") {
      await db.wbMarketplaceOrder.update({
        where: { id: order.id },
        data: { chatState: "READY" },
      });
    }
    out.chats += 1;
  }
  await touchCursor(db, CHATS_STREAM, { lastAttemptAt: new Date(), lastSuccessAt: new Date(), lastErrorCode: null });
}

function eventSentAt(event: WbChatEvent): Date {
  if (event.addTime) return safeDate(event.addTime);
  if (event.addTimestamp) {
    const ms = event.addTimestamp > 10_000_000_000 ? event.addTimestamp : event.addTimestamp * 1_000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

function eventRid(event: WbChatEvent): string | undefined {
  return event.message.attachments?.goodCard?.rid;
}

function isBuyerSender(sender: string) {
  return !/seller|supplier|manager/i.test(sender);
}

/** Сообщение, в котором нет ничего, кроме кода доставки.
 *
 * Такое сообщение целиком обрабатывает автоматика: код захватывается,
 * доставка закрывается, гейт уходит — оператору делать нечего, и в живой
 * карточке всё это уже видно строкой «код получен». Отдельное «сообщение
 * покупателя» на него было шумом ровно там, где заказ идёт лучше всего.
 *
 * Если рядом с цифрами написано хоть слово — «а куда его вводить?» — это уже
 * вопрос человеку, и уведомление уходит как обычно. */
function isNothingButDeliveryCode(rawText: string, deliveryCode: string | null): boolean {
  if (!deliveryCode) return false;
  return !/\p{L}/u.test(rawText);
}

const GUIDE_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL || "https://robloxbank.ru").replace(/\/$/, "");

/** Why a closing attempt did not happen. `null` means it ran.
 *
 * These used to be bare `return`s, which is exactly how F1 stayed invisible for
 * days: the delivery quietly failed to close, no audit row, no message, and
 * from the outside indistinguishable from a notification that never arrived. */
export type AutoReceiveSkip =
  | "flag_off"
  | "test_order"
  | "no_secret"
  | "already_closed"
  | "too_many_attempts"
  /** Заказ старше окна автозакрытия — доставку закрывает человек. */
  | "order_too_old"
  | "wb_not_in_delivery"
  /** WB прямо отклонил код — скорее всего покупатель прислал не то. */
  | "wb_rejected"
  /** WB не ответил внятно: повторять вслепую нельзя, решает человек. */
  | "wb_unknown"
  | null;

/** Исход попытки закрыть доставку.
 *
 * `closed` — не «мы не упали», а «доставка на WB действительно закрыта». Ровно
 * это и решает, можно ли отдавать покупателю гейт: раньше функция возвращала
 * `null` и на успехе, и на отказе WB, поэтому «Заказ подтверждён» уходило на
 * заказ, который WB только что отклонил (20.08, заказ 5540950769). */
export type AutoReceiveResult = { closed: boolean; skip: AutoReceiveSkip };

/** Hands the buyer's own code straight back to WB so the delivery closes itself.
 *
 * This runs the moment the code lands, before the gate is even minted: WB gives
 * roughly an hour from that message to close the delivery, and a blown window
 * cannot be recovered. The gate now waits for this to succeed — a code WB has
 * not accepted is not a confirmed order — and an order whose gate never went
 * out is held in front of the operator by `isWbBuyerUnserved`.
 *
 * Fail-closed on every error: the WB order simply stays open, which the
 * operator can always finish by hand inside the remaining window. A skip is now
 * reported back to the caller so it can say so out loud. */
async function tryAutoReceive(db: Db, orderId: string, wbOrderId: string): Promise<AutoReceiveResult> {
  if (process.env.WB_DBS_AUTO_RECEIVE !== "true") return { closed: false, skip: "flag_off" };
  if (process.env.WB_DBS_MUTATIONS_ENABLED !== "true") return { closed: false, skip: "flag_off" };

  const order = await db.wbMarketplaceOrder.findUnique({
    where: { id: orderId },
    include: { deliverySecret: true },
  });
  if (!order) return { closed: false, skip: "no_secret" };
  // Тестовый заказ не ходит в WB ни одним вызовом, поэтому «закрыт» для него —
  // это состояние флоу, а не факт на стороне WB. Иначе демо-прогон встал бы на
  // первом же шаге.
  if (order.isTest) return { closed: true, skip: "test_order" };
  if (!order.deliverySecret) return { closed: false, skip: "no_secret" };
  if (order.cancelledAt) return { closed: false, skip: "already_closed" };
  // Заказ уже закрыт — своим ли `receive`, или руками в кабинете WB. Обязательство
  // перед покупателем от этого не исчезает: гейт по такому заказу отдавать можно.
  if (order.completedAt) return { closed: true, skip: null };
  // Старше окна — код у нас есть, но доставку закрывает человек. Это решение
  // владельца, а не оптимизация: заказ, который лежит без кода четвёртый час,
  // уже разбирают руками, и «закрыть или отклонить» — часть того разбора.
  if (!wbAutoReceiveWithinWindow(order, order.deliverySecret.receivedAt)) {
    return { closed: false, skip: "order_too_old" };
  }
  if (wbReceiveRetriesExhausted(order.deliverySecret)) {
    return { closed: false, skip: "too_many_attempts" };
  }
  if (!canReceiveWbOrder({
    ...order,
    hasLiveSecret: wbDeliverySecretIsLive(order.deliverySecret),
    secretFailedAttempts: order.deliverySecret.failedAttempts,
  })) {
    // The only remaining precondition is WB's own status. Before auto-ship
    // existed this was the common case and the one nobody could see.
    return { closed: false, skip: "wb_not_in_delivery" };
  }

  try {
    // WB must still agree the order is out for delivery; its own view wins.
    const fresh = await fetchDbsStatuses([order.wbOrderId]);
    const status = fresh.orders.find((row) => row.orderId === order.wbOrderId);
    if (!status || !/deliver/i.test(status.supplierStatus ?? "")) {
      return { closed: false, skip: "wb_not_in_delivery" };
    }

    const code = decryptWbSecret(order.deliverySecret.encryptedValue, "delivery-code");
    assertBulkOrderSucceeded(await receiveDbsOrder(order.wbOrderId, code), order.wbOrderId);

    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.wbMarketplaceOrder.update({
        where: { id: orderId },
        data: { supplierStatus: "receive", wbStatus: "sold", completedAt: now, lastErrorCode: null },
      });
      await tx.wbDeliverySecret.update({
        where: { marketplaceOrderId: orderId },
        data: { encryptedValue: "PURGED", consumedAt: now },
      });
    });
    await audit(db, orderId, "WB_RECEIVE_SUCCEEDED", `auto-receive:${orderId}`, { source: "auto-receive" });
    await refreshDbsCard(db, orderId).catch(() => {});
    return { closed: true, skip: null };
  } catch (error) {
    const unknown = error instanceof WbDeliveryApiError && error.outcomeUnknown;
    const providerCode = error instanceof WbDeliveryApiError ? error.providerCode : safeErrorCode(error);
    await db.wbMarketplaceOrder.update({
      where: { id: orderId },
      data: { lastErrorCode: unknown ? "AUTO_RECEIVE_OUTCOME_UNKNOWN" : "AUTO_RECEIVE_FAILED" },
    }).catch(() => {});
    const attempts = await db.wbDeliverySecret.update({
      where: { marketplaceOrderId: orderId },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    }).catch(() => null);
    // Ключ идемпотентности с номером попытки: раньше он был один на заказ, и
    // вторая, третья, восьмая попытки в аудит просто не попадали — в истории
    // заказа 5540950769 стоит одна строка вместо трёх.
    await audit(db, orderId, "WB_STATUS_MUTATION_FAILED", `auto-receive-fail:${orderId}:${attempts?.failedAttempts ?? 0}`, {
      action: "receive",
      outcomeUnknown: unknown,
      // Причина отказа WB — единственное, по чему оператор отличает «код не тот»
      // от «WB лежит». Раньше не сохранялась нигде.
      providerCode,
      attempt: attempts?.failedAttempts ?? 0,
    }).catch(() => {});
    console.error(`[WbDbsSync] auto-receive failed for ${wbOrderId} (${providerCode}):`, error);
    const attempt = attempts?.failedAttempts ?? 0;
    const retryState = {
      failedAttempts: attempt,
      updatedAt: new Date(),
      receivedAt: order.deliverySecret.receivedAt,
    };
    const exhausted = wbReceiveRetriesExhausted(retryState);
    // Расписание кончилось, а отказ был внятным — только теперь код считается
    // неверным. Раньше это случалось на восьмой минуте, и код стирался, хотя WB
    // принимал его часом позже (заказ 5550714937, 22.08).
    if (exhausted && !unknown) {
      await askBuyerForAnotherCode(db, orderId, wbOrderId).catch((e) => {
        console.error(`[WbDbsSync] code retry request failed for ${wbOrderId}:`, safeErrorCode(e));
      });
    } else if (!unknown && attempt === WB_RECEIVE_RECHECK_AFTER_ATTEMPTS) {
      // Середина расписания: покупателя просят перепроверить код, но повторы
      // продолжаются и код остаётся у нас. Опечатку исправит только он, а лаг
      // WB переживём мы — сообщение обязано не выглядеть тупиком.
      await askBuyerToRecheckCode(db, orderId, wbOrderId, wbReceiveRetryDueAt(retryState)).catch((e) => {
        console.error(`[WbDbsSync] code recheck request failed for ${wbOrderId}:`, safeErrorCode(e));
      });
    } else if (attempt <= 1 || exhausted) {
      // Кричим на первой попытке и на последней. Пятнадцать попыток — это
      // пятнадцать одинаковых сообщений подряд, а промежуточные и так видны в
      // карточке: шум ровно там, где нужна ясность.
      notifyDbsAutoReceiveFailed(await dbsRef(db, orderId, wbOrderId), unknown, providerCode, wbReceiveRetryDueAt(retryState));
    }
    await refreshDbsCard(db, orderId).catch(() => {});
    return { closed: false, skip: unknown ? "wb_unknown" : "wb_rejected" };
  }
}

/** Покупателя просят перепроверить код, не прекращая повторы.
 *
 * Ровно одно такое сообщение на заказ, и claim идёт через уникальный ключ
 * аудита: `audit()` делает upsert и об уже существующей строке не сообщает, а
 * два сообщения подряд об одном и том же — худшее, что можно прислать человеку,
 * который и так не понимает, что происходит.
 *
 * Секрет остаётся живым: расписание повторов продолжает работать, а
 * `canCaptureDeliveryCode` теперь пропускает замену кода, по которому уже был
 * отказ, — так что исправленный код из чата не потеряется. */
async function askBuyerToRecheckCode(
  db: Db,
  orderId: string,
  wbOrderId: string,
  nextTryAt: Date | null,
) {
  const order = await db.wbMarketplaceOrder.findUnique({
    where: { id: orderId },
    include: { chats: { orderBy: { lastEventAt: "desc" as const }, take: 1 } },
  });
  if (!order || order.completedAt || order.cancelledAt) return;

  try {
    await db.wbMarketplaceEvent.create({
      data: {
        marketplaceOrderId: orderId,
        type: "DELIVERY_CODE_RECHECK_ASKED",
        idempotencyKey: `code-recheck:${orderId}`,
        actor: "wb-sync",
        payload: { attempts: WB_RECEIVE_RECHECK_AFTER_ATTEMPTS, nextTryAt: nextTryAt?.toISOString() ?? null },
      },
    });
  } catch (error) {
    // P2002 — просьба уже уходила, это штатный выход. Любая другая ошибка тоже
    // не повод писать покупателю вслепую: без записи в аудите дубль ничем не
    // остановить.
    if ((error as { code?: string }).code !== "P2002") {
      console.error(`[WbDbsSync] recheck claim failed for ${wbOrderId}:`, safeErrorCode(error));
    }
    return;
  }

  const chat = order.chats?.[0];
  const canAsk = !order.isTest
    && process.env.WB_CHAT_SEND_ENABLED === "true"
    && Boolean(chat?.replySignEncrypted);
  let asked = canAsk;
  if (canAsk && chat?.replySignEncrypted) {
    try {
      await sendBuyerChatMessage(decryptWbSecret(chat.replySignEncrypted, "reply-sign"), wbCodeRecheckMessage());
    } catch (error) {
      asked = false;
      console.error(`[WbDbsSync] code recheck message failed for ${wbOrderId}:`, safeErrorCode(error));
    }
  }
  notifyDbsCodeRecheck(await dbsRef(db, orderId, wbOrderId), asked, nextTryAt);
}

/** Сколько раз подряд мы готовы просить у покупателя другой код доставки.
 * Дальше это уже не «опечатка», а разговор, который ведёт человек. */
const MAX_CODE_RETRY_REQUESTS = 2;

/** Расписание повторов пройдено целиком — шесть часов и пятнадцать попыток, —
 * а WB так и не принял код. Вот теперь дело не в лагах WB.
 *
 * Что здесь важно по порядку: сначала снимается секрет — иначе истёкшее
 * расписание навсегда осталось бы с непригодным кодом, — затем `chatState`
 * возвращается в `CODE_REQUESTED` через CAS: кто перевёл состояние, тот и пишет
 * покупателю, поэтому дубля просьбы быть не может. */
async function askBuyerForAnotherCode(db: Db, orderId: string, wbOrderId: string) {
  const asked = await db.wbMarketplaceEvent.count({
    where: { marketplaceOrderId: orderId, type: "DELIVERY_CODE_REJECTED" },
  });
  const order = await db.wbMarketplaceOrder.findUnique({
    where: { id: orderId },
    include: { chats: { orderBy: { lastEventAt: "desc" as const }, take: 1 } },
  });
  if (!order || order.completedAt || order.cancelledAt) return;

  const claimed = await db.wbMarketplaceOrder.updateMany({
    where: { id: orderId, chatState: "CODE_RECEIVED" },
    data: { chatState: "CODE_REQUESTED", lastErrorCode: "DELIVERY_CODE_REJECTED" },
  });
  if (claimed.count !== 1) return;
  // Освобождаем место под следующий код покупателя. Отклонённый код WB больше
  // не примет, а хранить его — только мешать захвату нового.
  await db.wbDeliverySecret.update({
    where: { marketplaceOrderId: orderId },
    data: { encryptedValue: "PURGED", consumedAt: new Date() },
  }).catch(() => {});
  await audit(db, orderId, "DELIVERY_CODE_REJECTED", `code-rejected:${orderId}:${asked + 1}`, {
    attemptsExhausted: WB_RECEIVE_MAX_ATTEMPTS,
    askedBefore: asked,
  }).catch(() => {});

  const chat = order.chats?.[0];
  const canAsk = asked < MAX_CODE_RETRY_REQUESTS
    && !order.isTest
    && process.env.WB_CHAT_SEND_ENABLED === "true"
    && Boolean(chat?.replySignEncrypted);
  let asking = canAsk;
  if (canAsk && chat?.replySignEncrypted) {
    try {
      await sendBuyerChatMessage(decryptWbSecret(chat.replySignEncrypted, "reply-sign"), wbCodeRetryMessage());
    } catch (error) {
      // Упавшая отправка меняет не текст сообщения оператору, а его смысл:
      // покупателя никто ни о чём не попросил, и ждать от него нечего.
      asking = false;
      console.error(`[WbDbsSync] code retry request failed for ${wbOrderId}:`, safeErrorCode(error));
    }
  }
  // Уведомление уходит в любом случае: это единственный громкий сигнал о том,
  // что покупатель остался без выдачи, а карточка звука не даёт.
  notifyDbsCodeRejected(await dbsRef(db, orderId, wbOrderId), asking);
}

/** Closing the delivery used to get exactly one attempt, taken at the instant
 * the buyer's code arrived. If the order had not reached `deliver` yet — the
 * normal case once the auto-reply cut buyer response time to minutes — that
 * single chance was spent and never retried.
 *
 * This sweep gives every order holding a usable code another go, so a race lost
 * at capture time costs seconds, not the whole WB window.
 *
 * Паузы между попытками растут по расписанию (`WB_RECEIVE_RETRY_DELAYS_MIN`):
 * первые попытки почти подряд, дальше 10, 20, 30, 45 минут и час — до шести
 * часов с прихода кода. Причина в живом заказе `5550714937` (22.08): восемь
 * отказов `409` за восемь минут, код признан неверным и стёрт, — а тот же самый
 * код прошёл вручную через 3 ч 56 мин.
 *
 * Расписание нельзя выразить в `where`, поэтому выборка идёт грубым фильтром по
 * минимальной паузе, а точный срок считает `wbReceiveRetryDue` уже в памяти. */
async function retryAutoReceive(db: Db) {
  if (process.env.WB_DBS_AUTO_RECEIVE !== "true") return;
  if (process.env.WB_DBS_MUTATIONS_ENABLED !== "true") return;
  const now = new Date();
  const pending = await db.wbMarketplaceOrder.findMany({
    where: {
      isTest: false,
      completedAt: null,
      cancelledAt: null,
      deliverySecret: {
        is: {
          consumedAt: null,
          expiresAt: { gt: now },
          failedAttempts: { lt: WB_RECEIVE_MAX_ATTEMPTS },
          updatedAt: { lt: wbReceiveRetryCutoff(now) },
          receivedAt: { gt: new Date(now.getTime() - WB_RECEIVE_RETRY_HORIZON_MS) },
        },
      },
    },
    select: {
      id: true,
      wbOrderId: true,
      deliverySecret: { select: { failedAttempts: true, updatedAt: true, receivedAt: true } },
    },
    orderBy: { firstSeenAt: "asc" },
    take: 100,
  });
  const due = pending
    .filter((order) => order.deliverySecret && wbReceiveRetryDue(order.deliverySecret, now))
    .slice(0, 25);
  for (const order of due) {
    await tryAutoReceive(db, order.id, order.wbOrderId);
  }
}

/** Гейт за закрытой доставкой — вторым проходом, а не только в момент захвата
 * кода.
 *
 * Закрытие может состояться позже прихода кода: WB лагает, оператор закрывает
 * заказ руками в кабинете, попытка проходит на четвёртой минуте. Во всех этих
 * случаях покупателю всё равно нужно выдать код, и раньше это делал человек.
 *
 * Окно — сутки: старый заказ, закрытый когда-то без гейта, не должен внезапно
 * получить выдачу от прохода, который включили сегодня. */
const CLOSED_GATE_WINDOW_MS = 24 * 60 * 60_000;

async function dispatchGatesForClosedOrders(db: Db) {
  if (process.env.WB_DBS_AUTO_GATE !== "true") return;
  if (process.env.WB_CHAT_SEND_ENABLED !== "true") return;
  const closed = await db.wbMarketplaceOrder.findMany({
    where: {
      isTest: false,
      cancelledAt: null,
      wbCodeId: null,
      gateState: "NOT_ISSUED",
      denominationSnapshot: { not: null },
      completedAt: { gte: new Date(Date.now() - CLOSED_GATE_WINDOW_MS) },
    },
    select: { id: true, wbOrderId: true },
    orderBy: { completedAt: "asc" },
    take: 25,
  });
  for (const order of closed) {
    await tryAutoGate(db, order.id, order.wbOrderId);
  }
}

/** Walks DBS orders through WB's own `new → confirm → deliver` ladder.
 *
 * Nothing did this before: both mutations were manual buttons, so an order only
 * became closable if an operator happened to push it through the seller cabinet
 * first. For a digital handover there is nothing to assemble and nothing to
 * hand a courier — the two statuses are pure bookkeeping standing between us
 * and a closed delivery, and every minute they cost is WB commission.
 *
 * Fail-open per order: one rejection is recorded and the sweep moves on, so a
 * single bad order never stalls the queue behind it. */
async function tryAutoShip(db: Db, out: WbDeliverySyncResult) {
  if (process.env.WB_DBS_AUTO_SHIP !== "true") return;
  if (process.env.WB_DBS_MUTATIONS_ENABLED !== "true") return;

  const open = await db.wbMarketplaceOrder.findMany({
    where: {
      isTest: false,
      completedAt: null,
      cancelledAt: null,
      denominationSnapshot: { not: null },
      supplierStatus: { in: ["new", "confirm"] },
    },
    select: { id: true, wbOrderId: true, supplierStatus: true },
    orderBy: { firstSeenAt: "asc" },
    take: 25,
  });

  for (const order of open) {
    const action = wbAutoShipAction(order.supplierStatus);
    if (!action) continue;
    try {
      const response = action === "confirm"
        ? await confirmDbsOrder(order.wbOrderId)
        : await deliverDbsOrder(order.wbOrderId);
      assertBulkOrderSucceeded(response, order.wbOrderId);
      await db.wbMarketplaceOrder.update({
        where: { id: order.id },
        data: { supplierStatus: action === "confirm" ? "confirm" : "deliver", lastErrorCode: null },
      });
      await audit(db, order.id, `WB_${action.toUpperCase()}_SUCCEEDED`, `auto-ship:${order.id}:${action}`, {
        source: "auto-ship",
      });
      out.shipped += 1;
      await refreshDbsCard(db, order.id).catch(() => {});
    } catch (error) {
      // WB rejects `confirm` on an order it has already advanced elsewhere, and
      // that is not a fault — the next status poll will simply agree with WB.
      await audit(db, order.id, "WB_AUTO_SHIP_FAILED", `auto-ship-fail:${order.id}:${action}:${Date.now()}`, {
        action,
        error: safeErrorCode(error),
      }).catch(() => {});
      console.error(`[WbDbsSync] auto-ship ${action} failed for ${order.wbOrderId}:`, safeErrorCode(error));
    }
  }
}

/** WB gives roughly an hour from the buyer's code to close the delivery, and a
 * blown window costs real commission. When automation has not managed it in
 * time, the operator has to hear about it once — loudly, with the deadline.
 *
 * An order held back by the four-hour rule is deliberately not closed, so it is
 * not stuck. It already got its own message, with the code, at capture; this
 * one would contradict it by pushing the operator to close. */
async function alertStuckDeliveries(db: Db) {
  const cutoff = new Date(Date.now() - STUCK_DELIVERY_ALERT_MS);
  const stuck = await db.wbMarketplaceOrder.findMany({
    where: {
      isTest: false,
      completedAt: null,
      cancelledAt: null,
      deliveryAlertedAt: null,
      deliverySecret: { is: { consumedAt: null, receivedAt: { lt: cutoff }, expiresAt: { gt: new Date() } } },
    },
    select: {
      id: true,
      wbOrderId: true,
      supplierStatus: true,
      wbCreatedAt: true,
      firstSeenAt: true,
      deliverySecret: { select: { receivedAt: true } },
    },
    take: 10,
  });
  for (const order of stuck) {
    const receivedAt = order.deliverySecret?.receivedAt;
    if (receivedAt && !wbAutoReceiveWithinWindow(order, receivedAt)) continue;
    await db.wbMarketplaceOrder.update({
      where: { id: order.id },
      data: { deliveryAlertedAt: new Date() },
    });
    notifyDbsDeliveryStuck(
      await dbsRef(db, order.id, order.wbOrderId),
      order.supplierStatus,
      order.deliverySecret?.receivedAt ?? new Date(),
    );
  }
}

/** Сколько наших карточек в одной покупке и какая из них эта.
 *
 * `orderUid` общий у всех заказов одной корзины WB (`rid` = `<uid>.0.<n>`), так
 * что группировка не гадает по имени, времени и сумме. Без `orderUid` (старые
 * или неполные записи) считаем заказ одиночным — молчание лучше, чем «заказ 1
 * из 1». */
async function loadOrderSibling(
  db: Db,
  order: { wbOrderId: string; orderUid: string | null },
): Promise<WbOrderSibling | null> {
  if (!order.orderUid) return null;
  try {
    const siblings = await db.wbMarketplaceOrder.findMany({
      where: { orderUid: order.orderUid },
      select: { wbOrderId: true },
    });
    return wbSiblingPosition(order.wbOrderId, siblings);
  } catch {
    return null; // подсказка необязательна — она не должна ронять выдачу кода
  }
}

async function tryAutoGate(
  db: Db,
  orderId: string,
  wbOrderId: string,
) {
  if (process.env.WB_DBS_AUTO_GATE !== "true") return;
  if (process.env.WB_CHAT_SEND_ENABLED !== "true") return;

  const order = await db.wbMarketplaceOrder.findUnique({
    where: { id: orderId },
    include: {
      wbCode: true,
      chats: { orderBy: { lastEventAt: "desc" as const }, take: 1 },
    },
  });
  if (!order) return;
  // Порядок, а не гонка: сначала WB принимает код и доставка закрывается, и
  // только потом покупатель получает свой код. Иначе случайный набор цифр в
  // чате открывает выдачу — 20.08 покупателю ушло «Заказ подтверждён» на код,
  // который WB отклонил секундой раньше. Закрытие подождёт своего цикла:
  // `dispatchGatesForClosedOrders` вернётся сюда, как только оно случится.
  if (!canSendWbGate(order)) return;
  if (order.wbCode) return;
  if (!order.denominationSnapshot) return;

  const chat = order.chats?.[0];
  if (!chat?.replySignEncrypted) return;

  let activationCode: string | null = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = generateWbActivationCode();
    try {
      const created = await db.wbCode.create({
        data: {
          code: candidate,
          denomination: order.denominationSnapshot,
          isTest: order.isTest,
          batch: `DBS-AUTO-${new Date().toISOString().slice(0, 7)}`,
        },
      });
      activationCode = created.code;
      await db.wbMarketplaceOrder.update({
        where: { id: orderId },
        data: { wbCodeId: created.id, gateState: "ISSUED" },
      });
      break;
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  if (!activationCode) return;

  try {
    const replySign = decryptWbSecret(chat.replySignEncrypted, "reply-sign");
    if (!order.isTest) {
      await sendBuyerChatMessage(
        replySign,
        wbGateMessage(activationCode, order.denominationSnapshot, GUIDE_ORIGIN, await loadOrderSibling(db, order)),
      );
    }
    await db.wbMarketplaceOrder.update({
      where: { id: orderId },
      data: { gateState: "SENT", lastErrorCode: null, gateSentAt: new Date() },
    });
    await audit(db, orderId, "AUTO_GATE_ISSUED_AND_SENT", `auto-gate:${orderId}:${activationCode}`, {
      activationCode,
      isTest: order.isTest,
    });
    await refreshDbsCard(db, orderId).catch(() => {});
  } catch (e) {
    console.error(`[WbDbsSync] auto-gate send failed for ${wbOrderId}:`, e);
    await audit(db, orderId, "AUTO_GATE_SEND_FAILED", `auto-gate-fail:${orderId}`, {
      error: String(e),
    }).catch(() => {});
  }
}

type CaptureTarget = {
  id: string;
  wbOrderId: string;
  completedAt: Date | null;
  cancelledAt: Date | null;
  /** Момент оформления заказа: по нему считается окно автозакрытия и возраст
   * в уведомлении оператору. */
  wbCreatedAt: Date | null;
  firstSeenAt: Date;
};

/** The operator may answer the buyer straight from the WB seller cabinet. Any
 * outbound message means the conversation has started, so the console must stop
 * offering "send the instruction" as the next step. */
async function markCodeRequested(db: Db, order: CaptureTarget & { chatState: string }, eventId: string) {
  if (order.completedAt || order.cancelledAt) return;
  if (!shouldMarkCodeRequested(order.chatState)) return;
  const moved = await db.wbMarketplaceOrder.updateMany({
    where: { id: order.id, chatState: { in: ["WAITING_BUYER_CHAT", "READY"] } },
    data: { chatState: "CODE_REQUESTED" },
  });
  if (moved.count !== 1) return;
  await audit(db, order.id, "DELIVERY_CODE_REQUESTED", `seller-message:${eventId}`, { source: "wb-seller-cabinet" });
}

/** Capture is deliberately independent of `chatState`: the request may have been
 * sent from the WB cabinet, so the buyer's code must land whatever our own state
 * machine believes. A live secret is never overwritten. */
async function captureDeliveryCode(
  db: Db,
  order: CaptureTarget,
  code: string,
  receivedAt: Date,
  idempotencyKey: string,
  chatId: string,
): Promise<boolean> {
  if (!wbDeliveryCryptoReady()) return false;
  const existing = await db.wbDeliverySecret.findUnique({ where: { marketplaceOrderId: order.id } });
  if (!canCaptureDeliveryCode(order, existing)) return false;
  const expiresAt = new Date(receivedAt.getTime() + 24 * 60 * 60 * 1_000);
  if (expiresAt.getTime() <= Date.now()) return false;
  const secret = {
    encryptedValue: encryptWbSecret(code, "delivery-code"),
    codeHmac: wbSecretHmac(code, "delivery-code"),
    receivedAt,
    expiresAt,
  };
  await db.wbDeliverySecret.upsert({
    where: { marketplaceOrderId: order.id },
    create: { marketplaceOrderId: order.id, ...secret },
    update: { ...secret, consumedAt: null, failedAttempts: 0 },
  });
  await db.wbMarketplaceOrder.update({
    where: { id: order.id },
    data: { chatState: "CODE_RECEIVED", lastErrorCode: null },
  });
  await audit(db, order.id, "DELIVERY_CODE_CAPTURED", idempotencyKey, {
    chatId,
    receivedAt: receivedAt.toISOString(),
  });
  // Order matters twice over. WB's one-hour window is the only deadline we
  // cannot recover from, so the delivery is closed before anything else — and
  // the gate goes out only if that actually succeeded: «Заказ подтверждён» is a
  // statement about WB's own state, and a code WB rejected confirms nothing.
  // An unclosed order comes back here through `dispatchGatesForClosedOrders`.
  const { closed, skip } = await tryAutoReceive(db, order.id, order.wbOrderId);
  if (closed) await tryAutoGate(db, order.id, order.wbOrderId);
  // The notification is sent *after* the attempt so it can say what actually
  // happened. It used to fire first and claim "можно выпускать гейт" — advice
  // for a step the worker had already taken, next to a closing that had
  // silently not happened (F9, F10).
  await refreshDbsCard(db, order.id).catch(() => {});
  // Тихий успех живёт только в карточке. Отдельным сообщением уходит лишь то,
  // что требует человека: редактирование сообщения в Telegram не даёт
  // уведомления, и пропуск закрытия обязан прозвенеть.
  if (skip) {
    notifyDbsCodeCaptured(await dbsRef(db, order.id, order.wbOrderId), skip, skip === "order_too_old"
      // Код в сообщении — это и есть смысл уведомления: решение принимает
      // человек, а закрыть доставку в кабинете WB без кода он не сможет.
      ? { deliveryCode: code, ageHours: wbOrderAgeHours(order, receivedAt) }
      : undefined);
  }
  return true;
}

/** Safety net for codes that arrived while capture was broken or before the
 * order was linked to its chat: the events cursor has already moved past them,
 * so they would otherwise never be replayed. */
async function backfillDeliveryCodes(db: Db, out: WbDeliverySyncResult) {
  if (!wbDeliveryCryptoReady()) return;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1_000);
  const stuck = await db.wbMarketplaceOrder.findMany({
    where: {
      completedAt: null,
      cancelledAt: null,
      isTest: false,
      firstSeenAt: { gte: since },
      deliverySecret: { is: null },
    },
    select: {
      id: true,
      wbOrderId: true,
      completedAt: true,
      cancelledAt: true,
      wbCreatedAt: true,
      firstSeenAt: true,
    },
    take: 50,
  });
  for (const order of stuck) {
    // Deliberately ignores the stored `containsDeliveryCode` flag: it caches a
    // decision made by whichever extractor ran at insert time, so a message we
    // once failed to recognise would stay invisible forever. Re-reading the text
    // is what lets an extractor fix reach codes that already arrived.
    const events = await db.wbBuyerChatEvent.findMany({
      where: { marketplaceOrderId: order.id, sentAt: { gte: since } },
      orderBy: { sentAt: "desc" },
      take: 20,
    });
    for (const event of events) {
      if (!isBuyerSender(event.sender)) continue;
      const code = extractDeliveryCode(event.textRedacted ?? "");
      if (!code) continue;
      const captured = await captureDeliveryCode(db, order, code, event.sentAt, `delivery-code:${event.wbEventId}`, event.chatId);
      if (captured) {
        out.capturedCodes += 1;
        await db.wbBuyerChatEvent.update({
          where: { id: event.id },
          data: { containsDeliveryCode: true },
        }).catch(() => {});
      }
      break;
    }
  }
}

/** WB has no seller-first chat API, so the buyer's own first message is the
 * only moment we may greet them. Answering it by hand costs the buyer minutes
 * of waiting for exactly the same canned text every time.
 *
 * Exactly-once is enforced by claiming `chatState` with a CAS *before* sending:
 * whoever moves the order out of READY owns the send. A failed send leaves the
 * claim in place and records an error rather than retrying — a duplicate
 * greeting is worse than a missing one, and the console still offers
 * «Напомнить о коде». */
async function tryAutoRequestCode(
  db: Db,
  order: { id: string; wbOrderId: string; isTest: boolean; denominationSnapshot: number | null; lastErrorCode: string | null },
) {
  if (process.env.WB_DBS_AUTO_REPLY !== "true") return;
  if (process.env.WB_CHAT_SEND_ENABLED !== "true") return;
  if (order.isTest || order.lastErrorCode) return;

  const fresh = await db.wbMarketplaceOrder.findUnique({
    where: { id: order.id },
    include: {
      deliverySecret: true,
      chats: { orderBy: { lastEventAt: "desc" as const }, take: 1 },
    },
  });
  if (!fresh || fresh.completedAt || fresh.cancelledAt || fresh.lastErrorCode) return;
  // The buyer may have opened with the code itself — never ask for what we hold.
  if (wbDeliverySecretIsLive(fresh.deliverySecret)) return;
  const chat = fresh.chats?.[0];
  if (!chat?.replySignEncrypted) return;

  const claimed = await db.wbMarketplaceOrder.updateMany({
    where: { id: order.id, chatState: { in: ["WAITING_BUYER_CHAT", "READY"] } },
    data: { chatState: "CODE_REQUESTED" },
  });
  if (claimed.count !== 1) return;

  try {
    await sendBuyerChatMessage(decryptWbSecret(chat.replySignEncrypted, "reply-sign"), wbCodeRequestMessage());
    await audit(db, order.id, "DELIVERY_CODE_REQUESTED", `auto-request:${order.id}`, { source: "auto-reply" });
    await refreshDbsCard(db, order.id).catch(() => {});
  } catch (error) {
    const unknown = error instanceof WbDeliveryApiError && error.outcomeUnknown;
    await db.wbMarketplaceOrder.update({
      where: { id: order.id },
      data: {
        chatState: unknown ? "REQUEST_SEND_UNKNOWN" : "CODE_REQUESTED",
        lastErrorCode: unknown ? "AUTO_REQUEST_SEND_OUTCOME_UNKNOWN" : "AUTO_REQUEST_SEND_FAILED",
      },
    }).catch(() => {});
    await audit(db, order.id, "CHAT_SEND_FAILED", `auto-request-fail:${order.id}`, {
      kind: "auto-request",
      outcomeUnknown: unknown,
    }).catch(() => {});
    console.error(`[WbDbsSync] auto-reply failed for ${order.wbOrderId}:`, error);
  }
}

async function syncChatEvents(db: Db, out: WbDeliverySyncResult) {
  const cursor = await db.wbSyncCursor.findUnique({ where: { stream: EVENTS_STREAM } });
  const response = await fetchBuyerChatEvents(cursor?.cursor ?? undefined);
  for (const event of response.result.events) {
    const rawText = event.message.text ?? "";
    const deliveryCode = isBuyerSender(event.sender) ? extractDeliveryCode(rawText) : null;
    const existingChat = await db.wbBuyerChat.findUnique({ where: { chatId: event.chatID } });
    const rid = eventRid(event);
    const order = rid
      ? await db.wbMarketplaceOrder.findUnique({ where: { rid } })
      : existingChat?.marketplaceOrderId
        ? await db.wbMarketplaceOrder.findUnique({ where: { id: existingChat.marketplaceOrderId } })
        : null;
    const replySignEncrypted = event.replySign && wbDeliveryCryptoReady()
      ? encryptWbSecret(event.replySign, "reply-sign")
      : undefined;
    const sentAt = eventSentAt(event);
    const textRedacted = rawText ? redactWbChatText(rawText) : null;
    const outboundMirror = !isBuyerSender(event.sender) && textRedacted
      ? await db.wbBuyerChatEvent.findFirst({
        where: {
          chatId: event.chatID,
          wbEventId: { startsWith: "local:outbound:" },
          textRedacted,
          sentAt: {
            gte: new Date(sentAt.getTime() - 2 * 60_000),
            lte: new Date(sentAt.getTime() + 2 * 60_000),
          },
        },
        orderBy: { sentAt: "asc" },
      })
      : null;

    await db.wbBuyerChat.upsert({
      where: { chatId: event.chatID },
      create: {
        chatId: event.chatID,
        marketplaceOrderId: order?.id,
        replySignEncrypted,
        lastEventAt: sentAt,
      },
      update: {
        marketplaceOrderId: order?.id ?? existingChat?.marketplaceOrderId,
        ...(replySignEncrypted ? { replySignEncrypted } : {}),
        lastEventAt: sentAt,
      },
    });
    const providerEvent = await db.wbBuyerChatEvent.findUnique({ where: { wbEventId: event.eventID } });
    const eventData = {
        wbEventId: event.eventID,
        chatId: event.chatID,
        marketplaceOrderId: order?.id,
        eventType: event.eventType,
        sender: event.sender,
        textRedacted,
        containsDeliveryCode: Boolean(deliveryCode),
        isNewChat: event.isNewChat,
        sentAt,
        attachmentsMeta: {
          goodCard: Boolean(event.message.attachments?.goodCard),
          files: event.message.attachments?.files.length ?? 0,
          images: event.message.attachments?.images.length ?? 0,
        },
      };
    const isNewEvent = !providerEvent && !outboundMirror;
    if (providerEvent) {
      if (outboundMirror) await db.wbBuyerChatEvent.delete({ where: { id: outboundMirror.id } });
    } else if (outboundMirror) {
      await db.wbBuyerChatEvent.update({ where: { id: outboundMirror.id }, data: eventData });
    } else {
      await db.wbBuyerChatEvent.create({ data: eventData });
    }

    if (order) await rememberBuyerName(db, order, wbChatClientName(event), out);

    // Код доставки — не «сообщение покупателя»: его целиком обрабатывает
    // автоматика, оператору делать по нему нечего, а в карточке он и так виден
    // строкой «код получен». Отдельное уведомление на него было чистым шумом
    // ровно там, где заказ идёт лучше всего.
    if (isNewEvent && isBuyerSender(event.sender) && order && rawText
      && !isNothingButDeliveryCode(rawText, deliveryCode) && !order.completedAt && !order.cancelledAt) {
      notifyDbsBuyerMessage(await dbsRef(db, order.id, order.wbOrderId), rawText);
    }

    if (order && order.chatState === "WAITING_BUYER_CHAT") {
      await db.wbMarketplaceOrder.update({ where: { id: order.id }, data: { chatState: "READY" } });
    }
    if (isNewEvent && order && !isBuyerSender(event.sender)) {
      await markCodeRequested(db, order, event.eventID);
    }
    if (order && deliveryCode && !order.completedAt && !order.cancelledAt) {
      const captured = await captureDeliveryCode(db, order, deliveryCode, sentAt, `delivery-code:${event.eventID}`, event.chatID);
      if (captured) out.capturedCodes += 1;
    }
    // Runs after capture so an opening message that already carries the code
    // never triggers a request for it.
    if (isNewEvent && order && isBuyerSender(event.sender) && !order.completedAt && !order.cancelledAt) {
      await tryAutoRequestCode(db, order);
    }
    out.chatEvents += 1;
  }
  await touchCursor(db, EVENTS_STREAM, {
    cursor: response.result.next ?? cursor?.cursor,
    lastAttemptAt: new Date(),
    lastSuccessAt: new Date(),
    lastErrorCode: null,
  });
}

/** Puts a human name on every open order so an operator can tie the WB chat to
 * the conversation in our own bot. Best-effort throughout: WB only serves this
 * after `confirm`, so a miss is normal and must never set `lastErrorCode` or
 * stop the cycle. Only orders still missing a name are ever asked for. */
async function syncBuyerNames(db: Db, out: WbDeliverySyncResult) {
  const nameless = await db.wbMarketplaceOrder.findMany({
    where: { isTest: false, cancelledAt: null, buyerName: null },
    select: { id: true, wbOrderId: true },
    orderBy: { firstSeenAt: "desc" },
    take: 100,
  });
  if (!nameless.length) return;
  for (let offset = 0; offset < nameless.length; offset += 50) {
    const chunk = nameless.slice(offset, offset + 50);
    const response = await fetchDbsClients(chunk.map((row) => row.wbOrderId));
    for (const row of response.orders) {
      const wbOrderId = wbClientOrderId(row);
      const name = wbBuyerName(row);
      if (!wbOrderId || !name) continue;
      const match = chunk.find((candidate) => candidate.wbOrderId === wbOrderId);
      if (!match) continue;
      await db.wbMarketplaceOrder.update({ where: { id: match.id }, data: { buyerName: name } });
      await audit(db, match.id, "BUYER_NAME_RESOLVED", `buyer-name:${match.id}`, { hasName: true });
      out.buyerNames += 1;
    }
  }
  await touchCursor(db, CLIENTS_STREAM, { lastAttemptAt: new Date(), lastSuccessAt: new Date(), lastErrorCode: null });
}

type StatusTarget = {
  id: string;
  wbOrderId: string;
  supplierStatus: string;
  wbStatus: string;
  cancelledAt: Date | null;
  completedAt: Date | null;
};

const STATUS_TARGET_SELECT = {
  id: true,
  wbOrderId: true,
  supplierStatus: true,
  wbStatus: true,
  cancelledAt: true,
  completedAt: true,
} as const;

/** Writes one WB status verdict onto our own order and mirrors a cancellation
 * into the rest of the system exactly once. */
async function applyWbStatus(
  db: Db,
  order: StatusTarget,
  status: { supplierStatus?: string; wbStatus?: string; errors: Array<{ code?: string | number }> },
  out: WbDeliverySyncResult,
) {
  const { cancelled, completed } = wbMarketplaceTerminalFlags(status.supplierStatus, status.wbStatus);
  const now = new Date();
  const errorCode = status.errors[0]?.code ? `WB_${status.errors[0].code}` : undefined;
  // Most polls find nothing new. Writing anyway would bump `updatedAt` on every
  // cycle, and the queue is sorted by it — the list would reshuffle under the
  // operator's cursor once a minute for no reason.
  const settled =
    (!status.supplierStatus || status.supplierStatus === order.supplierStatus) &&
    (!status.wbStatus || status.wbStatus === order.wbStatus) &&
    cancelled === Boolean(order.cancelledAt) &&
    (cancelled ? !order.completedAt : completed === Boolean(order.completedAt)) &&
    !errorCode;
  if (settled) return;

  await db.wbMarketplaceOrder.update({
    where: { id: order.id },
    data: {
      supplierStatus: status.supplierStatus,
      wbStatus: status.wbStatus,
      // Both timestamps keep the moment they were first observed, so a status
      // poll running every minute does not keep re-dating a closed order.
      cancelledAt: cancelled ? order.cancelledAt ?? now : undefined,
      // A cancellation retracts an earlier completion. Without this the order
      // stays filed under "Готово" while WB has already refunded the buyer.
      completedAt: cancelled ? null : completed ? order.completedAt ?? now : undefined,
      lastSeenAt: now,
      // A healthy poll clears the field. Passing `undefined` — which is what
      // this did — means "leave it alone" to Prisma, so a stale error survived
      // forever and, while closing was gated on it, disabled the order's
      // automation for good (F2).
      lastErrorCode: errorCode ?? null,
    },
  });
  out.statuses += 1;
  if (cancelled && !order.cancelledAt) {
    out.cancellations += 1;
    await propagateCancellation(db, order.id, order.wbOrderId, `${status.supplierStatus ?? ""}/${status.wbStatus ?? ""}`);
  }
}

async function fetchAndApplyStatuses(db: Db, targets: StatusTarget[], out: WbDeliverySyncResult) {
  for (let offset = 0; offset < targets.length; offset += 100) {
    const chunk = targets.slice(offset, offset + 100);
    const response = await fetchDbsStatuses(chunk.map((row) => row.wbOrderId));
    for (const status of response.orders) {
      const match = chunk.find((row) => row.wbOrderId === status.orderId);
      if (match) await applyWbStatus(db, match, status, out);
    }
  }
}

/** A WB cancellation refunds the buyer, so anything we opened on the back of
 * that order has to close too — otherwise the buyout queue keeps a job nobody
 * is paying for, which is exactly how cancelled orders became dead weight.
 *
 * Only orders that have cost us nothing yet are closed automatically; a
 * purchase in flight or already made is left alone and stays visible in the
 * console as `attention` for a human to settle. Either way the admins hear
 * about it, because a refund on a delivered order is never routine. */
async function propagateCancellation(db: Db, orderId: string, wbOrderId: string, wbStatus: string) {
  const order = await db.wbMarketplaceOrder.findUnique({
    where: { id: orderId },
    include: { wbCode: { select: { code: true } } },
  });
  const code = order?.wbCode?.code ?? null;
  const internal = code
    ? await db.wbOrder.findUnique({
      where: { wbCode: code },
      select: { id: true, status: true, adminNote: true, robloxUsername: true },
    })
    : null;

  let outcome: "rejected" | "needs_human" | "no_internal_order" = "no_internal_order";
  if (internal && !["COMPLETED", "REJECTED"].includes(internal.status)) {
    if (canAutoRejectInternalOrder(internal.status)) {
      const mark = `[WB ОТМЕНА ${new Date().toISOString().slice(0, 10)}] заказ WB #${wbOrderId} отменён (${wbStatus}) — выкуп закрыт автоматически`;
      await db.wbOrder.update({
        where: { id: internal.id },
        data: {
          status: "REJECTED",
          rejectionReason: `Заказ WB #${wbOrderId} отменён на Wildberries (${wbStatus})`,
          adminNote: internal.adminNote ? `${mark}\n${internal.adminNote}`.slice(0, 2_000) : mark,
        },
      });
      outcome = "rejected";
    } else {
      outcome = "needs_human";
    }
  }

  await audit(db, orderId, "WB_ORDER_CANCELLED", `wb-cancelled:${orderId}`, {
    wbStatus,
    activationCode: code,
    internalStatus: internal?.status ?? null,
    outcome,
  }).catch(() => {});
  notifyDbsOrderCancelled(await dbsRef(db, orderId, wbOrderId), wbStatus, internal?.status ?? null, outcome);
  await refreshDbsCard(db, orderId).catch(() => {});
}

async function syncStatuses(db: Db, out: WbDeliverySyncResult) {
  const active = await db.wbMarketplaceOrder.findMany({
    where: { isTest: false, completedAt: null, cancelledAt: null },
    select: STATUS_TARGET_SELECT,
    take: 1000,
  });
  await fetchAndApplyStatuses(db, active, out);
  await touchCursor(db, STATUSES_STREAM, { lastAttemptAt: new Date(), lastSuccessAt: new Date(), lastErrorCode: null });
}

/** Closing an order is not the end of its story: WB reports returns and
 * refusals as a status change on an order it had already handed over
 * (`receive/canceled`), and a buyer can decline at the door long after we filed
 * the order away. The open-order poll can never see those, because it only
 * looks at orders with no `completedAt`.
 *
 * Cancelled orders are swept too. They are already terminal, but their stored
 * status text can be stale — an order cancelled on WB while our own row still
 * read `completed` showed «Отменён» and «Завершён» side by side. `applyWbStatus`
 * writes nothing once a row agrees with WB, so re-reading them is free. */
async function recheckClosedOrders(db: Db, out: WbDeliverySyncResult) {
  const since = new Date(Date.now() - CLOSED_RECHECK_DAYS * 24 * 60 * 60 * 1_000);
  const closed = await db.wbMarketplaceOrder.findMany({
    where: {
      isTest: false,
      OR: [{ completedAt: { gte: since } }, { cancelledAt: { gte: since } }],
    },
    select: STATUS_TARGET_SELECT,
    orderBy: { lastSeenAt: "desc" },
    take: 300,
  });
  await fetchAndApplyStatuses(db, closed, out);
  await touchCursor(db, RECHECK_STREAM, { lastAttemptAt: new Date(), lastSuccessAt: new Date(), lastErrorCode: null });
}

async function syncCompleted(db: Db, out: WbDeliverySyncResult) {
  const dateTo = new Date();
  const dateFrom = new Date(dateTo.getTime() - 7 * 24 * 60 * 60 * 1_000);
  let next = "0";
  for (let page = 0; page < 10; page += 1) {
    const response = await fetchCompletedDbsOrders({ dateFrom, dateTo, next });
    for (const order of response.orders) {
      await upsertMarketplaceOrder(db, order, undefined, "completed");
      out.completedOrders += 1;
    }
    if (!response.next || response.next === "0" || response.next === next || response.orders.length === 0) break;
    next = response.next;
  }
  await touchCursor(db, COMPLETED_STREAM, { lastAttemptAt: new Date(), lastSuccessAt: new Date(), lastErrorCode: null });
}

/** Expiry blanks the code but keeps the row.
 *
 * Two bugs lived here. It stamped `DELIVERY_CODE_EXPIRED` on *any* order whose
 * secret aged out, including ones already closed and settled — those then
 * surfaced as `attention` and, while `lastErrorCode` still gated closing,
 * disabled automation for them permanently (F5 + F2).
 *
 * And it deleted the row outright, taking `codeHmac` with it. That hash is how
 * a buyer who types their WB delivery code into our bot gets recognised instead
 * of being told "no active orders", so it is kept for a week — long enough for
 * the manual branch to be useful — while the code itself is destroyed on time. */
async function purgeExpiredDeliverySecrets(db: Db) {
  const expired = await db.wbDeliverySecret.findMany({
    where: {
      expiresAt: { lt: new Date() },
      consumedAt: null,
      encryptedValue: { not: "PURGED" },
    },
    select: {
      marketplaceOrderId: true,
      marketplaceOrder: { select: { gateState: true, completedAt: true, cancelledAt: true } },
    },
    take: 200,
  });
  for (const secret of expired) {
    const settled = Boolean(secret.marketplaceOrder.completedAt || secret.marketplaceOrder.cancelledAt);
    await db.$transaction([
      db.wbDeliverySecret.update({
        where: { marketplaceOrderId: secret.marketplaceOrderId },
        data: { encryptedValue: "PURGED" },
      }),
      db.wbMarketplaceOrder.update({
        where: { id: secret.marketplaceOrderId },
        data: settled
          // Nothing is owed on a closed order, so an expired code is a
          // non-event. Saying otherwise cried wolf on every finished sale.
          ? {}
          : secret.marketplaceOrder.gateState === "NOT_ISSUED"
            ? { chatState: "READY", lastErrorCode: null }
            : { lastErrorCode: "DELIVERY_CODE_EXPIRED" },
      }),
    ]);
    await audit(db, secret.marketplaceOrderId, "DELIVERY_CODE_EXPIRED", `delivery-code-expired:${secret.marketplaceOrderId}`, {
      purged: true,
      settled,
    });
  }
  // The hash outlives the code but not by much: a week covers every realistic
  // "the buyer wrote to us the next day" case and nothing beyond it.
  await db.wbDeliverySecret.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60_000) } },
  });
}

/** Э7: a gate link nobody opened is a paid order we never delivered.
 *
 * Five of the first thirty-six codes were never opened — 14 % of paid orders
 * sitting silent, with no nudge of any kind. Two reminders, three hours and a
 * day out, then it stops and the order belongs to a person. */
async function remindUnopenedGates(db: Db, out: WbDeliverySyncResult) {
  if (process.env.WB_DBS_GATE_REMINDERS !== "true") return;
  if (process.env.WB_CHAT_SEND_ENABLED !== "true") return;

  const oldest = GATE_REMINDERS[0].afterMs;
  const candidates = await db.wbMarketplaceOrder.findMany({
    where: {
      isTest: false,
      cancelledAt: null,
      gateState: "SENT",
      gateReminderLevel: { lt: GATE_REMINDERS[GATE_REMINDERS.length - 1].level },
      gateSentAt: { not: null, lt: new Date(Date.now() - oldest) },
    },
    select: {
      id: true,
      wbOrderId: true,
      orderUid: true,
      gateSentAt: true,
      gateReminderLevel: true,
      denominationSnapshot: true,
      wbCode: { select: { code: true } },
      chats: { orderBy: { lastEventAt: "desc" as const }, take: 1 },
    },
    take: 20,
  });

  for (const order of candidates) {
    const activationCode = order.wbCode?.code;
    if (!activationCode || !order.gateSentAt) continue;
    // Опоздавших не будим: заказ, который покупатель уже открыл, из выборки
    // убирает наличие внутреннего заказа по этому коду.
    const internal = await db.wbOrder.findUnique({ where: { wbCode: activationCode }, select: { id: true } });
    if (internal) {
      await db.wbMarketplaceOrder.update({
        where: { id: order.id },
        data: { gateReminderLevel: GATE_REMINDERS[GATE_REMINDERS.length - 1].level },
      });
      continue;
    }
    const age = Date.now() - order.gateSentAt.getTime();
    const due = GATE_REMINDERS.filter((r) => age >= r.afterMs && r.level > order.gateReminderLevel).at(-1);
    if (!due) continue;
    const chat = order.chats?.[0];
    if (!chat?.replySignEncrypted) continue;

    // Claim the level before sending: a duplicate nudge is worse than a missing
    // one, and the same CAS rule already guards the auto-reply.
    const claimed = await db.wbMarketplaceOrder.updateMany({
      where: { id: order.id, gateReminderLevel: order.gateReminderLevel },
      data: { gateReminderLevel: due.level },
    });
    if (claimed.count !== 1) continue;

    try {
      await sendBuyerChatMessage(
        decryptWbSecret(chat.replySignEncrypted, "reply-sign"),
        wbGateReminderMessage(
          activationCode,
          order.denominationSnapshot,
          due.level,
          GUIDE_ORIGIN,
          await loadOrderSibling(db, order),
        ),
      );
      await audit(db, order.id, "GATE_REMINDER_SENT", `gate-reminder:${order.id}:${due.level}`, {
        level: due.level,
      });
      out.gateReminders += 1;
      if (due.level === GATE_REMINDERS[GATE_REMINDERS.length - 1].level) {
        notifyDbsGateNotOpened(await dbsRef(db, order.id, order.wbOrderId));
      }
    } catch (error) {
      console.error(`[WbDbsSync] gate reminder failed for ${order.wbOrderId}:`, safeErrorCode(error));
    }
  }
}

/** Read-only WB synchronization. It never confirms, delivers, receives or sends
 * a buyer message; all provider mutations remain explicit operator actions. */
/** Один цикл синхронизации.
 *
 * Каждый шаг изолирован. Раньше цикл был «всё или ничего», и это ровно та же
 * ошибка, что и `lastErrorCode` внутри отдельного заказа, только уровнем выше:
 * контур ходит в **два независимых сервиса WB** — `marketplace-api` (заказы,
 * статусы, смена статуса) и `buyer-chat-api` (чат покупателя). Когда 20.08 лёг
 * чат (500 на `/seller/chats`, 504 на `/seller/events`), исключение из
 * `syncChatEvents` обрывало цикл до всего остального — и вместе с чатом
 * переставали работать опрос статусов, автоперевод в доставку и автозакрытие,
 * хотя marketplace в это время отвечал 200.
 *
 * Теперь падение одного шага записывается на его собственный курсор и цикл идёт
 * дальше. `errorCode` в результате остаётся — консоль по-прежнему покажет
 * оператору, что чат недоступен, — но работа, которая от чата не зависит, уже
 * сделана. */
export async function runWbDeliverySync(db: Db, options: { force?: boolean } = {}): Promise<WbDeliverySyncResult> {
  const out = result();
  let leaseId: string | null = null;
  const failures: string[] = [];

  /** Выполняет шаг, не давая ему уронить остальные. */
  const step = async (name: string, run: () => Promise<void>, stream?: string) => {
    try {
      await run();
    } catch (error) {
      const code = safeErrorCode(error);
      failures.push(`${name}:${code}`);
      out.errorCode ??= code;
      console.error(`[WbDbsSync] ${name} failed: ${code}`);
      if (stream) {
        await touchCursor(db, stream, { lastAttemptAt: new Date(), lastErrorCode: code }).catch(() => {});
      }
    }
  };

  try {
    leaseId = await acquireLease(db);
    if (!leaseId) return out;
    out.acquired = true;
    const force = options.force === true;

    await step("purge", () => purgeExpiredDeliverySecrets(db));

    await step("new-orders", async () => {
      const response = await fetchNewDbsOrders();
      const datesResponse = await fetchDbsDeliveryDates(response.orders.map((order) => order.id));
      const dates = new Map(datesResponse.orders.map((row) => [row.id, row]));
      for (const order of response.orders) {
        const existed = await db.wbMarketplaceOrder.findUnique({ where: { wbOrderId: order.id }, select: { id: true } });
        const record = await upsertMarketplaceOrder(db, order, dates.get(order.id), "new");
        if (!existed) {
          // Карточка заказа заменяет прежнее отдельное «новый заказ»: дальше она
          // же будет обновляться на каждом шаге вместо новых сообщений.
          await refreshDbsCard(db, record.id).catch(() => {});
        }
        out.newOrders += 1;
      }
    });

    // ── Чат покупателя: buyer-chat-api ────────────────────────────────────
    if (await streamDue(db, CHATS_STREAM, 60_000, force)) {
      await step("chat-directory", () => syncChatDirectory(db, out), CHATS_STREAM);
    }
    await step("chat-events", () => syncChatEvents(db, out), EVENTS_STREAM);
    await step("backfill-codes", () => backfillDeliveryCodes(db, out));

    // ── Обязательства перед WB: marketplace-api ───────────────────────────
    // Всё ниже не зависит от чата и обязано идти, даже если чат недоступен:
    // окно на закрытие доставки — единственный дедлайн, который не отыграть.
    await step("auto-ship", () => tryAutoShip(db, out));
    await step("auto-receive", () => retryAutoReceive(db));
    // Строго после закрытия: гейт уходит только за закрытой доставкой, и этот
    // проход — то место, где покупатель получает свой код, если закрытие
    // случилось позже прихода кода (лаг WB или закрытие руками в кабинете).
    await step("auto-gate", () => dispatchGatesForClosedOrders(db));
    await step("stuck-alert", () => alertStuckDeliveries(db));

    if (await streamDue(db, STATUSES_STREAM, 60_000, force)) {
      await step("statuses", () => syncStatuses(db, out), STATUSES_STREAM);
    }
    // Returns and refusals arrive on orders we already closed, so the finished
    // pile is swept on its own slower cadence.
    if (await streamDue(db, RECHECK_STREAM, 10 * 60_000, force)) {
      await step("closed-recheck", () => recheckClosedOrders(db, out), RECHECK_STREAM);
    }
    if (await streamDue(db, COMPLETED_STREAM, 5 * 60_000, force)) {
      await step("completed", () => syncCompleted(db, out), COMPLETED_STREAM);
    }
    // A nicer label is never worth a failed cycle: WB serves buyer data only
    // after `confirm`, so misses are routine and stay out of the error path.
    if (await streamDue(db, CLIENTS_STREAM, 60_000, force)) {
      await syncBuyerNames(db, out).catch((error) => {
        console.error(`[WbDbsSync] buyer names skipped: ${safeErrorCode(error)}`);
      });
    }
    // Nudging a silent buyer is never urgent and never worth a failed cycle.
    if (await streamDue(db, REMINDERS_STREAM, 10 * 60_000, force)) {
      await remindUnopenedGates(db, out).catch((error) => {
        console.error(`[WbDbsSync] gate reminders skipped: ${safeErrorCode(error)}`);
      });
      await touchCursor(db, REMINDERS_STREAM, { lastAttemptAt: new Date(), lastSuccessAt: new Date() });
    }

    // «Здоров» — только когда действительно всё прошло. Частичный отказ виден
    // и по статусу, и по составу: оператору важно, ЧТО именно не работает.
    const status = failures.length ? `DEGRADED:${failures[0]}`.slice(0, 160) : "HEALTHY";
    await db.serviceHeartbeat.upsert({
      where: { serviceKey: HEARTBEAT_KEY },
      create: { serviceKey: HEARTBEAT_KEY, lastSeenAt: new Date(), status },
      update: { lastSeenAt: new Date(), status },
    });
    await releaseLease(db, leaseId, failures.length ? out.errorCode : null);
    return out;
  } catch (error) {
    const errorCode = safeErrorCode(error);
    out.errorCode = errorCode;
    if (leaseId) await releaseLease(db, leaseId, errorCode).catch(() => {});
    await db.serviceHeartbeat.upsert({
      where: { serviceKey: HEARTBEAT_KEY },
      create: { serviceKey: HEARTBEAT_KEY, lastSeenAt: new Date(), status: errorCode },
      update: { lastSeenAt: new Date(), status: errorCode },
    }).catch(() => {});
    return out;
  }
}

export function startWbDeliveryWorker(db: Db) {
  if (process.env.WB_DBS_SYNC_ENABLED !== "true") return false;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const sync = await runWbDeliverySync(db);
      if (sync.errorCode) console.error(`[WbDbsSync] ${sync.errorCode}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 10_000);
  setInterval(() => void tick(), 5_000);
  return true;
}
