import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { generateWbActivationCode } from "./wb-activation-code";
import { wbGateMessage } from "./wb-gate-link";
import {
  fetchBuyerChatEvents,
  fetchBuyerChats,
  fetchCompletedDbsOrders,
  fetchDbsDeliveryDates,
  fetchDbsStatuses,
  fetchNewDbsOrders,
  sendBuyerChatMessage,
  WbDeliveryApiError,
} from "./wb-delivery-api";
import {
  deliveryWindow,
  safeDate,
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
  canCaptureDeliveryCode,
  shouldMarkCodeRequested,
  wbMarketplaceTerminalFlags,
  wbProductVendorCandidates,
} from "./wb-delivery-policy";
import { notifyDbsNewOrder, notifyDbsBuyerMessage, notifyDbsCodeCaptured, notifyDbsAutoGateIssued } from "./wb-delivery-admin-notify";

const WORKER_STREAM = "wb-dbs-worker";
const EVENTS_STREAM = "wb-buyer-chat-events";
const CHATS_STREAM = "wb-buyer-chats";
const STATUSES_STREAM = "wb-dbs-statuses";
const COMPLETED_STREAM = "wb-dbs-completed";
const HEARTBEAT_KEY = "wb-dbs-sync";
const LEASE_MS = 45_000;

type Db = PrismaClient;

export type WbDeliverySyncResult = {
  acquired: boolean;
  newOrders: number;
  completedOrders: number;
  statuses: number;
  chats: number;
  chatEvents: number;
  capturedCodes: number;
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
  const { cancelled, completed } = wbMarketplaceTerminalFlags(
    order.supplierStatus,
    order.wbStatus,
    source === "completed",
  );
  const lastErrorCode = product?.denomination ? null : "MISSING_DENOMINATION";
  const shared = {
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
    supplierStatus: order.supplierStatus ?? (source === "completed" ? "completed" : "new"),
    wbStatus: order.wbStatus ?? (source === "completed" ? "completed" : "waiting"),
    lastErrorCode,
    lastSeenAt: now,
    completedAt: completed ? now : undefined,
    cancelledAt: cancelled ? now : undefined,
  };
  const record = await db.wbMarketplaceOrder.upsert({
    where: { wbOrderId: order.id },
    create: { wbOrderId: order.id, ...shared },
    update: shared,
  });
  await audit(db, record.id, "ORDER_SYNCED", `order:${order.id}:${source}`, {
    source,
    supplierStatus: shared.supplierStatus,
    wbStatus: shared.wbStatus,
    mapped: Boolean(product?.denomination),
  });
  return record;
}

function chatOrderWhere(chat: WbChat) {
  const rid = chat.goodCard?.rid;
  return rid ? { rid } : null;
}

async function syncChatDirectory(db: Db, out: WbDeliverySyncResult) {
  const response = await fetchBuyerChats();
  for (const chat of response.result) {
    const orderWhere = chatOrderWhere(chat);
    const order = orderWhere
      ? await db.wbMarketplaceOrder.findUnique({ where: orderWhere })
      : null;
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

const GUIDE_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL || "https://robloxbank.ru").replace(/\/$/, "");

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
  if (!order || order.completedAt || order.cancelledAt) return;
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
      await sendBuyerChatMessage(replySign, wbGateMessage(activationCode, order.denominationSnapshot, GUIDE_ORIGIN));
    }
    await db.wbMarketplaceOrder.update({
      where: { id: orderId },
      data: { gateState: "SENT", lastErrorCode: null },
    });
    await audit(db, orderId, "AUTO_GATE_ISSUED_AND_SENT", `auto-gate:${orderId}:${activationCode}`, {
      activationCode,
      isTest: order.isTest,
    });
    notifyDbsAutoGateIssued(wbOrderId, activationCode);
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
  notifyDbsCodeCaptured(order.wbOrderId);
  await tryAutoGate(db, order.id, order.wbOrderId);
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
    select: { id: true, wbOrderId: true, completedAt: true, cancelledAt: true },
    take: 50,
  });
  for (const order of stuck) {
    const events = await db.wbBuyerChatEvent.findMany({
      where: {
        marketplaceOrderId: order.id,
        containsDeliveryCode: true,
        sentAt: { gte: since },
      },
      orderBy: { sentAt: "desc" },
      take: 5,
    });
    for (const event of events) {
      const code = extractDeliveryCode(event.textRedacted ?? "");
      if (!code) continue;
      const captured = await captureDeliveryCode(db, order, code, event.sentAt, `delivery-code:${event.wbEventId}`, event.chatId);
      if (captured) out.capturedCodes += 1;
      break;
    }
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

    if (isNewEvent && isBuyerSender(event.sender) && order && rawText && !order.completedAt && !order.cancelledAt) {
      notifyDbsBuyerMessage(order.wbOrderId, event.sender, rawText);
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
    out.chatEvents += 1;
  }
  await touchCursor(db, EVENTS_STREAM, {
    cursor: response.result.next ?? cursor?.cursor,
    lastAttemptAt: new Date(),
    lastSuccessAt: new Date(),
    lastErrorCode: null,
  });
}

async function syncStatuses(db: Db, out: WbDeliverySyncResult) {
  const active = await db.wbMarketplaceOrder.findMany({
    where: { isTest: false, completedAt: null, cancelledAt: null },
    select: { id: true, wbOrderId: true },
    take: 1000,
  });
  for (let offset = 0; offset < active.length; offset += 100) {
    const chunk = active.slice(offset, offset + 100);
    const response = await fetchDbsStatuses(chunk.map((row: { wbOrderId: string }) => row.wbOrderId));
    for (const status of response.orders) {
      const match = chunk.find((row: { wbOrderId: string }) => row.wbOrderId === status.orderId);
      if (!match) continue;
      const { cancelled, completed } = wbMarketplaceTerminalFlags(status.supplierStatus, status.wbStatus);
      await db.wbMarketplaceOrder.update({
        where: { id: match.id },
        data: {
          supplierStatus: status.supplierStatus,
          wbStatus: status.wbStatus,
          cancelledAt: cancelled ? new Date() : undefined,
          completedAt: completed ? new Date() : undefined,
          lastSeenAt: new Date(),
          lastErrorCode: status.errors[0]?.code ? `WB_${status.errors[0].code}` : undefined,
        },
      });
      out.statuses += 1;
    }
  }
  await touchCursor(db, STATUSES_STREAM, { lastAttemptAt: new Date(), lastSuccessAt: new Date(), lastErrorCode: null });
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

async function purgeExpiredDeliverySecrets(db: Db) {
  const expired = await db.wbDeliverySecret.findMany({
    where: { expiresAt: { lt: new Date() }, consumedAt: null },
    select: { marketplaceOrderId: true, marketplaceOrder: { select: { gateState: true } } },
    take: 200,
  });
  for (const secret of expired) {
    await db.$transaction([
      db.wbDeliverySecret.delete({ where: { marketplaceOrderId: secret.marketplaceOrderId } }),
      db.wbMarketplaceOrder.update({
        where: { id: secret.marketplaceOrderId },
        data: secret.marketplaceOrder.gateState === "NOT_ISSUED"
          ? { chatState: "READY", lastErrorCode: null }
          : { lastErrorCode: "DELIVERY_CODE_EXPIRED" },
      }),
    ]);
    await audit(db, secret.marketplaceOrderId, "DELIVERY_CODE_EXPIRED", `delivery-code-expired:${secret.marketplaceOrderId}`, {
      purged: true,
    });
  }
}

/** Read-only WB synchronization. It never confirms, delivers, receives or sends
 * a buyer message; all provider mutations remain explicit operator actions. */
export async function runWbDeliverySync(db: Db, options: { force?: boolean } = {}): Promise<WbDeliverySyncResult> {
  const out = result();
  let leaseId: string | null = null;
  try {
    leaseId = await acquireLease(db);
    if (!leaseId) return out;
    out.acquired = true;
    const force = options.force === true;

    await purgeExpiredDeliverySecrets(db);

    const response = await fetchNewDbsOrders();
    const datesResponse = await fetchDbsDeliveryDates(response.orders.map((order) => order.id));
    const dates = new Map(datesResponse.orders.map((row) => [row.id, row]));
    for (const order of response.orders) {
      const existed = await db.wbMarketplaceOrder.findUnique({ where: { wbOrderId: order.id }, select: { id: true } });
      const record = await upsertMarketplaceOrder(db, order, dates.get(order.id), "new");
      if (!existed) {
        notifyDbsNewOrder(order.id, record.denominationSnapshot, record.finalPriceKopecks);
      }
      out.newOrders += 1;
    }

    if (await streamDue(db, CHATS_STREAM, 60_000, force)) await syncChatDirectory(db, out);
    await syncChatEvents(db, out);
    await backfillDeliveryCodes(db, out);
    if (await streamDue(db, STATUSES_STREAM, 60_000, force)) await syncStatuses(db, out);
    if (await streamDue(db, COMPLETED_STREAM, 5 * 60_000, force)) await syncCompleted(db, out);

    await db.serviceHeartbeat.upsert({
      where: { serviceKey: HEARTBEAT_KEY },
      create: { serviceKey: HEARTBEAT_KEY, lastSeenAt: new Date(), status: "HEALTHY" },
      update: { lastSeenAt: new Date(), status: "HEALTHY" },
    });
    await releaseLease(db, leaseId, null);
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
