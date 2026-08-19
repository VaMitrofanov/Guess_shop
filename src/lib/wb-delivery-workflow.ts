import "server-only";

import crypto from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  WbDeliveryActionResponse,
  WbDeliveryOrderDto,
  WbDeliveryOverview,
} from "@/types/wb-delivery";
import {
  assertBulkOrderSucceeded,
  confirmDbsOrder,
  deliverDbsOrder,
  fetchDbsStatuses,
  receiveDbsOrder,
  sendBuyerChatMessage,
  wbDeliveryApiReadiness,
  WbDeliveryApiError,
} from "../../bots/shared/wb-delivery-api";
import {
  decryptWbSecret,
  encryptWbSecret,
  redactWbChatText,
  wbDeliveryCryptoReady,
  wbSecretHmac,
} from "../../bots/shared/wb-delivery-crypto";
import {
  canCreateInternalOrder,
  canIssueWbGate,
  canReceiveWbOrder,
  isWbBuyerUnserved,
  wbCancelledCodeAtRisk,
  wbDeliverySecretIsLive,
  wbFunnelStep,
  wbGateDelivered,
  wbDeliveryStage,
} from "../../bots/shared/wb-delivery-policy";
import { BuyoutError, resolveGamepass } from "@/lib/roblox-buyout";
import { checkGamepassPrice, expectedGamepassPrice } from "@/lib/purchase-guard";
import { runWbDeliverySync } from "../../bots/shared/wb-delivery-sync";
import { generateWbActivationCode } from "../../bots/shared/wb-activation-code";
import { wbCodeRequestMessage, wbGateMessage, wbGateUrl } from "../../bots/shared/wb-gate-link";
import { WB_TERMINAL_STAGES, WB_URGENT_STAGES } from "@/lib/wb-delivery-labels";

const db = prisma;
const GUIDE_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL || "https://robloxbank.ru").replace(/\/$/, "");

/** The queue renders a dozen scalar fields per order. Loading the full chat and
 * audit trail for every row cost up to 150×160 joined rows on a poll that runs
 * every 20 seconds, so the list keeps only what it draws; the detail view asks
 * for the rest one order at a time. */
const listOrderInclude = Prisma.validator<Prisma.WbMarketplaceOrderInclude>()({
  wbCode: { select: { code: true, denomination: true, status: true } },
  deliverySecret: true,
  chats: { orderBy: { lastEventAt: "desc" }, take: 1 },
});

const detailOrderInclude = Prisma.validator<Prisma.WbMarketplaceOrderInclude>()({
  wbCode: { select: { code: true, denomination: true, status: true } },
  deliverySecret: true,
  chats: {
    orderBy: { lastEventAt: "desc" },
    take: 1,
    include: { events: { orderBy: { sentAt: "desc" }, take: 80 } },
  },
  events: { orderBy: { createdAt: "desc" }, take: 80 },
});

const actionOrderInclude = Prisma.validator<Prisma.WbMarketplaceOrderInclude>()({
  wbCode: true,
  deliverySecret: true,
  chats: { orderBy: { lastEventAt: "desc" }, take: 1 },
});

type InternalFulfillment = { status: string; platform: string | null; robloxUsername: string | null };
type DetailOrder = Prisma.WbMarketplaceOrderGetPayload<{ include: typeof detailOrderInclude }>;
type DetailChat = DetailOrder["chats"][number];
/** One DTO builder serves both queries, so the parts only the detail view loads
 * are optional here and render as empty for a list row. */
type ListOrder =
  & Omit<DetailOrder, "chats" | "events">
  & {
    chats: Array<Omit<DetailChat, "events"> & { events?: DetailChat["events"] }>;
    events?: DetailOrder["events"];
    internalFulfillment: InternalFulfillment | null;
  };
type ActionOrder = Prisma.WbMarketplaceOrderGetPayload<{ include: typeof actionOrderInclude }>;

export const WbDeliveryActionSchema = z.object({
  action: z.enum([
    "sync",
    "request_code",
    "remind_code",
    "save_delivery_code",
    "issue_gate",
    "send_gate",
    "mark_gate_sent",
    "mark_served_externally",
    "send_message",
    "confirm",
    "deliver",
    "receive",
    "preview_gamepass",
    "create_internal_order",
  ]),
  orderId: z.string().min(1).max(80).optional(),
  code: z.string().trim().regex(/^\d{5,7}$/).optional(),
  message: z.string().trim().min(1).max(1_000).optional(),
  /** Game pass link or bare numeric id for the manual buyout order. */
  gamepass: z.string().trim().min(1).max(200).optional(),
  /** Overrides the pass owner when the buyer bought from someone else's pass. */
  robloxUsername: z.string().trim().max(60).optional(),
  /** Operator confirmed a price or duplicate warning and wants it anyway. */
  force: z.boolean().optional(),
});

export type WbDeliveryActionInput = z.infer<typeof WbDeliveryActionSchema>;

export class WbDeliveryWorkflowError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "INVALID_ACTION",
  ) {
    super(message);
  }
}

function flag(name: string) {
  return process.env[name] === "true";
}

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function liveSecret(secret: ActionOrder["deliverySecret"]) {
  return wbDeliverySecretIsLive(secret);
}

function gateUrl(code: string | null | undefined) {
  return code ? wbGateUrl(code, GUIDE_ORIGIN) : null;
}

function direction(sender: string): "buyer" | "seller" | "system" {
  if (/seller|supplier|manager|operator/i.test(sender)) return "seller";
  if (/system|worker/i.test(sender)) return "system";
  return "buyer";
}

/** Every disabled button must say why. Without this the console silently stops
 * responding and the operator cannot tell a policy gate from an outage. */
function blockedReason(order: ListOrder, chatReady: boolean, terminal: boolean, unserved: boolean): string | null {
  if (wbCancelledCodeAtRisk({ ...order, internalStatus: order.internalFulfillment?.status ?? null })) {
    return "Покупатель отменил заказ на WB и получил деньги обратно, но выпущенный код ещё не потрачен. Отклоните внутренний заказ во вкладке «Заказы», иначе робуксы уйдут бесплатно.";
  }
  if (unserved) {
    return "Заказ закрыт на WB, но покупатель так и не получил код гейта. Выпустите код и отправьте его в чат — деньги уже приняты.";
  }
  if (terminal) return null;
  if (!chatReady) return "Покупатель ещё не открыл чат по этому заказу — WB не даёт писать первым.";
  if (order.lastErrorCode) {
    return `Последнее действие завершилось с ошибкой ${order.lastErrorCode}. Синхронизируйте заказ и сверьте кабинет WB.`;
  }
  if (!order.isTest && !flag("WB_CHAT_SEND_ENABLED")) {
    return "Отправка сообщений в WB выключена флагом WB_CHAT_SEND_ENABLED — включите его в Coolify на Web и TG.";
  }
  if (!order.isTest && !flag("WB_DBS_MUTATIONS_ENABLED")) {
    return "Смена статусов WB выключена флагом WB_DBS_MUTATIONS_ENABLED — включите его в Coolify на Web и TG.";
  }
  if (!wbDeliveryCryptoReady()) return "Не настроен WB_DELIVERY_ENCRYPTION_KEY — код доставки негде хранить.";
  if (!order.denominationSnapshot) return "Для товара не найден номинал в каталоге — гейт выпустить нельзя.";
  return null;
}

/** The delivery code is a single-use, high-risk credential. It is the argument
 * to our own `receive` call, not something the queue needs, so it is decrypted
 * only for a single explicitly opened order — never for a list of 150 shipped
 * on a 20-second poll (docs/wb-dbs-delivery-plan.md §5, §11). */
function toDto(order: ListOrder, { revealSecret = false } = {}): WbDeliveryOrderDto {
  const secretIsLive = liveSecret(order.deliverySecret);
  const policyOrder = {
    ...order,
    hasLiveSecret: secretIsLive,
    internalStatus: order.internalFulfillment?.status ?? null,
    internalRobloxUsername: order.internalFulfillment?.robloxUsername ?? null,
  };
  const chat = order.chats?.[0] ?? null;
  const activationCode = order.wbCode?.code ?? null;
  const stage = wbDeliveryStage(policyOrder);
  const chatReady = Boolean(chat?.replySignEncrypted || order.isTest);
  const terminal = Boolean(order.completedAt || order.cancelledAt);
  const awaitingCode = !terminal && chatReady && !secretIsLive && !order.lastErrorCode;
  const alreadyAsked = order.chatState === "CODE_REQUESTED" || order.chatState === "REQUEST_SEND_UNKNOWN";
  // Closing the WB order settles the marketplace side; it does not end our
  // delivery. Gate issuance, gate delivery and plain support replies stay open
  // until the buyer actually holds a code — they are gated on cancellation, not
  // completion. Only the WB status mutations themselves stay strictly terminal.
  const unserved = isWbBuyerUnserved(policyOrder);
  const deliverable = !order.cancelledAt && chatReady && (!terminal || unserved);
  return {
    id: order.id,
    wbOrderId: order.wbOrderId,
    rid: order.rid,
    nmId: order.nmId,
    vendorCode: order.vendorCode,
    buyerName: order.buyerName,
    funnelStep: wbFunnelStep(policyOrder),
    denomination: order.denominationSnapshot,
    priceKopecks: order.priceKopecks,
    finalPriceKopecks: order.finalPriceKopecks,
    deliveryFrom: iso(order.deliveryFrom),
    deliveryTo: iso(order.deliveryTo),
    supplierStatus: order.supplierStatus,
    wbStatus: order.wbStatus,
    chatState: order.chatState,
    gateState: order.gateState,
    stage,
    lastErrorCode: order.lastErrorCode,
    firstSeenAt: order.firstSeenAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    completedAt: iso(order.completedAt),
    cancelledAt: iso(order.cancelledAt),
    chatId: chat?.chatId ?? null,
    chatReady,
    deliveryCode: {
      present: Boolean(order.deliverySecret),
      valid: secretIsLive,
      value: revealSecret && secretIsLive && order.deliverySecret
        ? decryptWbSecret(order.deliverySecret.encryptedValue, "delivery-code")
        : null,
      receivedAt: iso(order.deliverySecret?.receivedAt),
      expiresAt: iso(order.deliverySecret?.expiresAt),
      consumedAt: iso(order.deliverySecret?.consumedAt),
    },
    activationCode,
    gateUrl: gateUrl(activationCode),
    fulfillment: order.internalFulfillment ?? null,
    unserved,
    blockedReason: blockedReason(order, chatReady, terminal, unserved),
    permissions: {
      requestCode: awaitingCode && !alreadyAsked,
      remindCode: awaitingCode && alreadyAsked,
      saveDeliveryCode: !terminal && chatReady && wbDeliveryCryptoReady(),
      issueGate: canIssueWbGate(policyOrder),
      sendGate: deliverable && order.gateState === "ISSUED" && Boolean(activationCode),
      markGateSent: !order.cancelledAt && ["ISSUED", "SENDING", "SEND_UNKNOWN"].includes(order.gateState) && Boolean(activationCode),
      // Escape hatch for orders settled before this system existed, or by
      // other means: closes the obligation without faking a minted code.
      markServedExternally: unserved,
      // Game pass search does not always find the buyer's pass, so the operator
      // needs the same "create it by hand" door the ordinary WB queue has.
      createInternalOrder: canCreateInternalOrder({
        cancelledAt: order.cancelledAt,
        gateState: order.gateState,
        activationCode,
        internalStatus: order.internalFulfillment?.status ?? null,
      }),
      confirm: !terminal && !order.lastErrorCode && !/confirm|deliver|sold|receive/i.test(order.supplierStatus),
      deliver: !terminal && !order.lastErrorCode && /confirm/i.test(order.supplierStatus),
      receive: canReceiveWbOrder(policyOrder),
      // Support matters most exactly when an order has gone wrong, so replying
      // stays available for as long as WB keeps the chat open.
      sendMessage: !order.cancelledAt && chatReady && !order.lastErrorCode,
    },
    chat: (chat?.events ?? []).map((event) => ({
      id: event.id,
      sender: event.sender,
      text: event.textRedacted,
      containsDeliveryCode: event.containsDeliveryCode,
      sentAt: event.sentAt.toISOString(),
      direction: direction(event.sender),
      // Our own optimistic mirror: WB has not echoed this message back yet, so
      // the operator must not read it as confirmed delivery to the buyer.
      pending: event.wbEventId.startsWith("local:outbound:"),
    })),
    audit: (order.events ?? []).map((event) => ({
      id: event.id,
      type: event.type,
      actor: event.actor,
      createdAt: event.createdAt.toISOString(),
      payload: event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
        ? event.payload as Record<string, unknown>
        : {},
    })),
  };
}

async function loadOrders() {
  const orders = await db.wbMarketplaceOrder.findMany({
    // Synthetic rows bypass both live flags and the WB chat entirely, so they
    // prove nothing about the real flow while sitting next to real money.
    //
    // A buyer's own cancellation is dead weight: the money went back and there
    // is nothing to do. The exception is a cancellation that still carries a
    // minted code — that one is money at risk and is kept, then surfaced as
    // `attention` by `wbCancelledCodeAtRisk`.
    where: {
      isTest: false,
      OR: [
        { cancelledAt: null },
        { cancelledAt: { not: null }, gateState: { in: ["ISSUED", "SENDING", "SENT", "SEND_UNKNOWN"] } },
      ],
    },
    // Postgres sorts NULLs last on ASC, so ordering by `completedAt` alone put
    // every finished order above the live queue. Open work comes first.
    orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { updatedAt: "desc" }],
    take: 150,
    include: {
      ...listOrderInclude,
    },
  });
  const codes = orders.flatMap((order) => order.wbCode?.code ? [order.wbCode.code] : []);
  const fulfillmentRows = codes.length
    ? await db.wbOrder.findMany({
      where: { wbCode: { in: codes } },
      select: { wbCode: true, status: true, platform: true, robloxUsername: true },
    })
    : [];
  const fulfillment = new Map<string, InternalFulfillment>(fulfillmentRows.map((row) => [row.wbCode, {
    status: row.status,
    platform: row.platform,
    robloxUsername: row.robloxUsername,
  }]));
  return orders.map((order) => ({
    ...order,
    internalFulfillment: order.wbCode?.code ? fulfillment.get(order.wbCode.code) ?? null : null,
  }));
}

export async function loadWbDeliveryOverview(): Promise<WbDeliveryOverview> {
  const [orders, heartbeat, workerCursor] = await Promise.all([
    loadOrders(),
    db.serviceHeartbeat.findUnique({ where: { serviceKey: "wb-dbs-sync" } }),
    db.wbSyncCursor.findUnique({ where: { stream: "wb-dbs-worker" } }),
  ]);
  const dtos: WbDeliveryOrderDto[] = orders.map((order) => toDto(order));
  const api = wbDeliveryApiReadiness();
  return {
    generatedAt: new Date().toISOString(),
    environment: {
      syncEnabled: flag("WB_DBS_SYNC_ENABLED"),
      chatSendEnabled: flag("WB_CHAT_SEND_ENABLED"),
      mutationsEnabled: flag("WB_DBS_MUTATIONS_ENABLED"),
      cryptoReady: wbDeliveryCryptoReady(),
      marketplaceApiReady: api.marketplace,
      chatApiReady: api.chat,
      scopedMarketplaceToken: api.scopedMarketplace,
      scopedChatToken: api.scopedChat,
      workerStatus: heartbeat?.status ?? "NOT_STARTED",
      workerLastSeenAt: iso(heartbeat?.lastSeenAt),
      workerError: workerCursor?.lastErrorCode ?? null,
    },
    // Every counter is derived from `stage`, the same axis the console filters
    // on. Mixing in raw timestamps is what made the hero number and the tab of
    // the same name show different orders.
    metrics: {
      active: dtos.filter((order) => !WB_TERMINAL_STAGES.includes(order.stage)).length,
      urgent: dtos.filter((order) => WB_URGENT_STAGES.includes(order.stage)).length,
      attention: dtos.filter((order) => order.stage === "attention").length,
      waitingCode: dtos.filter((order) => order.stage === "waiting_code").length,
      codeReceived: dtos.filter((order) => order.stage === "code_received").length,
      readyReceive: dtos.filter((order) => order.stage === "ready_receive").length,
      inBot: dtos.filter((order) => order.stage === "in_bot").length,
      completed: dtos.filter((order) => order.stage === "complete").length,
    },
    orders: dtos,
  };
}

export async function loadWbDeliveryOrder(orderId: string): Promise<WbDeliveryOrderDto | null> {
  const order = await db.wbMarketplaceOrder.findUnique({
    where: { id: orderId },
    include: {
      ...detailOrderInclude,
    },
  });
  if (!order) return null;
  const fulfillment = order.wbCode?.code
    ? await db.wbOrder.findUnique({
      where: { wbCode: order.wbCode.code },
      select: { status: true, platform: true, robloxUsername: true },
    })
    : null;
  // One order, opened deliberately by a named admin: this is the only place the
  // operator can read the delivery code, which they need when WB rejects our
  // own `receive` and the order has to be closed by hand in the seller cabinet.
  return toDto({ ...order, internalFulfillment: fulfillment }, { revealSecret: true });
}

async function getOrder(orderId: string | undefined) {
  if (!orderId) throw new WbDeliveryWorkflowError("Не выбран заказ", 400, "ORDER_REQUIRED");
  const order = await db.wbMarketplaceOrder.findUnique({
    where: { id: orderId },
    include: {
      ...actionOrderInclude,
    },
  });
  if (!order) throw new WbDeliveryWorkflowError("Заказ не найден", 404, "ORDER_NOT_FOUND");
  return order;
}

async function audit(orderId: string, type: string, actor: string, payload: Record<string, unknown> = {}) {
  await db.wbMarketplaceEvent.create({
    data: {
      marketplaceOrderId: orderId,
      type,
      idempotencyKey: `${type}:${orderId}:${crypto.randomUUID()}`,
      actor,
      payload: payload as Prisma.InputJsonObject,
    },
  });
}

function requireCrypto() {
  if (!wbDeliveryCryptoReady()) {
    throw new WbDeliveryWorkflowError("Шифрование кода доставки не настроено", 503, "CRYPTO_NOT_READY");
  }
}

function requireLiveFlag(name: "WB_CHAT_SEND_ENABLED" | "WB_DBS_MUTATIONS_ENABLED", order: ActionOrder) {
  if (!order.isTest && !flag(name)) {
    throw new WbDeliveryWorkflowError(
      name === "WB_CHAT_SEND_ENABLED"
        ? "Отправка сообщений WB пока выключена"
        : "Изменение статусов WB пока выключено",
      409,
      `${name}_OFF`,
    );
  }
}

async function appendDemoChat(order: ActionOrder, sender: "buyer" | "seller" | "system", text: string, containsCode = false) {
  const chat = order.chats?.[0];
  if (!chat) throw new WbDeliveryWorkflowError("Чат заказа ещё не найден", 409, "CHAT_NOT_READY");
  const sentAt = new Date();
  await db.wbBuyerChatEvent.create({
    data: {
      wbEventId: `demo:${crypto.randomUUID()}`,
      chatId: chat.chatId,
      marketplaceOrderId: order.id,
      eventType: "message",
      sender,
      textRedacted: redactWbChatText(text),
      containsDeliveryCode: containsCode,
      sentAt,
      attachmentsMeta: {},
    },
  });
  await db.wbBuyerChat.update({ where: { chatId: chat.chatId }, data: { lastEventAt: sentAt } });
}

async function appendOutboundMirror(order: ActionOrder, text: string) {
  const chat = order.chats?.[0];
  if (!chat) return;
  const sentAt = new Date();
  const textRedacted = redactWbChatText(text);
  const providerEcho = await db.wbBuyerChatEvent.findFirst({
    where: {
      chatId: chat.chatId,
      wbEventId: { not: { startsWith: "local:outbound:" } },
      textRedacted,
      sentAt: { gte: new Date(sentAt.getTime() - 2 * 60_000) },
    },
    select: { id: true },
  });
  if (!providerEcho) {
    await db.wbBuyerChatEvent.create({
      data: {
        wbEventId: `local:outbound:${crypto.randomUUID()}`,
        chatId: chat.chatId,
        marketplaceOrderId: order.id,
        eventType: "message",
        sender: "seller",
        textRedacted,
        sentAt,
        attachmentsMeta: { pendingProviderEcho: true },
      },
    });
  }
  await db.wbBuyerChat.update({ where: { chatId: chat.chatId }, data: { lastEventAt: sentAt } });
}

async function replySignFor(order: ActionOrder) {
  const chat = order.chats?.[0];
  if (!chat?.replySignEncrypted) {
    throw new WbDeliveryWorkflowError("Чат покупателя ещё не готов для ответа", 409, "CHAT_NOT_READY");
  }
  requireCrypto();
  return decryptWbSecret(chat.replySignEncrypted, "reply-sign");
}

async function sendText(order: ActionOrder, text: string, actor: string, kind: "request" | "gate" | "message") {
  requireLiveFlag("WB_CHAT_SEND_ENABLED", order);
  if (order.isTest) {
    await appendDemoChat(order, "seller", text);
    return;
  }
  try {
    await sendBuyerChatMessage(await replySignFor(order), text);
  } catch (error) {
    const unknown = error instanceof WbDeliveryApiError && error.outcomeUnknown;
    await db.wbMarketplaceOrder.update({
      where: { id: order.id },
      data: {
        lastErrorCode: unknown ? `${kind.toUpperCase()}_SEND_OUTCOME_UNKNOWN` : `${kind.toUpperCase()}_SEND_FAILED`,
        ...(kind === "request" && unknown ? { chatState: "REQUEST_SEND_UNKNOWN" } : {}),
        ...(kind === "gate" && unknown ? { gateState: "SEND_UNKNOWN" } : {}),
      },
    });
    await audit(order.id, "CHAT_SEND_FAILED", actor, { kind, outcomeUnknown: unknown });
    throw new WbDeliveryWorkflowError(
      unknown ? "WB не подтвердил отправку. Сначала проверьте чат, не повторяйте вслепую." : "WB отклонил отправку сообщения",
      502,
      unknown ? "SEND_OUTCOME_UNKNOWN" : "SEND_FAILED",
    );
  }
  await appendOutboundMirror(order, text).catch(async () => {
    await audit(order.id, "CHAT_MIRROR_FAILED", actor, { kind }).catch(() => {});
  });
}


async function createUniqueCode(tx: Prisma.TransactionClient, denomination: number, isTest: boolean) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateWbActivationCode();
    try {
      return await tx.wbCode.create({
        data: {
          code,
          denomination,
          isTest,
          batch: `DBS-${new Date().toISOString().slice(0, 7)}`,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  throw new WbDeliveryWorkflowError("Не удалось выпустить уникальный код", 503, "CODE_EXHAUSTED");
}

async function saveDeliveryCode(order: ActionOrder, code: string, actor: string, source: "manual" | "demo") {
  requireCrypto();
  if (order.completedAt || order.cancelledAt) {
    throw new WbDeliveryWorkflowError("Заказ уже закрыт", 409, "ORDER_TERMINAL");
  }
  const now = new Date();
  await db.$transaction([
    db.wbDeliverySecret.upsert({
      where: { marketplaceOrderId: order.id },
      create: {
        marketplaceOrderId: order.id,
        encryptedValue: encryptWbSecret(code, "delivery-code"),
        codeHmac: wbSecretHmac(code, "delivery-code"),
        receivedAt: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
      },
      update: {
        encryptedValue: encryptWbSecret(code, "delivery-code"),
        codeHmac: wbSecretHmac(code, "delivery-code"),
        receivedAt: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
        consumedAt: null,
        failedAttempts: 0,
      },
    }),
    db.wbMarketplaceOrder.update({
      where: { id: order.id },
      data: { chatState: "CODE_RECEIVED", lastErrorCode: null },
    }),
  ]);
  if (source === "demo") await appendDemoChat(order, "buyer", code, true);
  await audit(order.id, "DELIVERY_CODE_CAPTURED", actor, { source, receivedAt: now.toISOString() });
}

/** Everything the console needs to show before an operator commits to opening a
 * buyout order by hand: who owns the pass, what Roblox charges for it, and what
 * this denomination is supposed to cost. */
async function previewGamepass(order: ActionOrder, raw: string) {
  const denomination = order.denominationSnapshot;
  let pass;
  try {
    pass = await resolveGamepass(raw);
  } catch (error) {
    throw new WbDeliveryWorkflowError(
      error instanceof BuyoutError ? error.message : "Не удалось прочитать геймпасс",
      400,
      "GAMEPASS_UNRESOLVED",
    );
  }
  const price = checkGamepassPrice(denomination ?? 0, pass.price, pass.basePriceInRobux);
  const duplicate = await db.wbOrder.findFirst({
    where: {
      isTest: false,
      gamepassId: String(pass.gamepassId),
      status: { in: ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS"] },
    },
    orderBy: { createdAt: "desc" },
    select: { wbCode: true, status: true, orderSource: true },
  });
  return {
    gamepassId: String(pass.gamepassId),
    gamepassUrl: `https://www.roblox.com/game-pass/${pass.gamepassId}`,
    name: pass.name,
    robloxUsername: pass.sellerName,
    price: pass.price,
    basePrice: pass.basePriceInRobux,
    isForSale: pass.isForSale,
    denomination,
    expectedPrice: denomination ? expectedGamepassPrice(denomination) : null,
    priceOk: Boolean(denomination) && price.ok,
    duplicate: duplicate ? { wbCode: duplicate.wbCode, status: duplicate.status, orderSource: duplicate.orderSource } : null,
  };
}

/** Opens the ordinary buyout order for a DBS sale by hand.
 *
 * The buyer normally does this themselves by activating the gate code in the
 * bot; when game pass search cannot find their pass, the operator has to. The
 * result is deliberately an ordinary `WbOrder` keyed on the same gate code —
 * `orderSource: WB_DBS` is the only difference — so it lands in the same buyout
 * queue, guards and accounting as every other order rather than in a parallel
 * flow that has to be maintained twice. */
async function createInternalOrder(
  order: ActionOrder,
  actor: string,
  input: { gamepass: string; robloxUsername?: string; force?: boolean },
): Promise<WbDeliveryActionResponse> {
  const activationCode = order.wbCode?.code ?? null;
  const existing = activationCode
    ? await db.wbOrder.findUnique({ where: { wbCode: activationCode }, select: { status: true } })
    : null;
  if (!canCreateInternalOrder({
    cancelledAt: order.cancelledAt,
    gateState: order.gateState,
    activationCode,
    internalStatus: existing?.status ?? null,
  })) {
    throw new WbDeliveryWorkflowError(
      order.cancelledAt
        ? "Заказ отменён на WB — выкуп по нему открывать нельзя"
        : existing
          ? `По коду ${activationCode} уже есть заказ (${existing.status})`
          : "Сначала выпустите и отправьте покупателю код гейта — заказ на выкуп привязывается к нему",
      409,
      "CREATE_PRECONDITION",
    );
  }
  const denomination = order.denominationSnapshot;
  if (!denomination) {
    throw new WbDeliveryWorkflowError("Для товара не настроен номинал — сумма заказа неизвестна", 409, "MISSING_DENOMINATION");
  }

  const preview = await previewGamepass(order, input.gamepass);
  if (!preview.isForSale && !input.force) {
    throw new WbDeliveryWorkflowError("Геймпасс снят с продажи — выкупить его нельзя", 409, "GAMEPASS_NOT_FOR_SALE");
  }
  if (!preview.priceOk && !input.force) {
    throw new WbDeliveryWorkflowError(
      `Цена геймпасса ${preview.price} R$ не сходится с номиналом ${denomination} R$ (ожидается ${preview.expectedPrice} R$). Проверьте пасс или подтвердите создание принудительно.`,
      409,
      "PRICE_MISMATCH",
    );
  }
  if (preview.duplicate && !input.force) {
    throw new WbDeliveryWorkflowError(
      `На этот геймпасс уже есть активный заказ ${preview.duplicate.wbCode} (${preview.duplicate.status})`,
      409,
      "GAMEPASS_DUPLICATE",
    );
  }

  const nick = (input.robloxUsername || preview.robloxUsername || "").trim().replace(/^@/, "") || null;
  const stamp = new Date().toISOString().slice(0, 10);
  const mark = `[DBS MANUAL ${stamp} от ${actor}] заказ WB #${order.wbOrderId}, геймпасс добавлен вручную из раздела DBS`;

  const created = await db.$transaction(async (tx) => {
    const wbOrder = await tx.wbOrder.create({
      data: {
        amount: denomination,
        gamepassUrl: preview.gamepassUrl,
        gamepassId: preview.gamepassId,
        robloxUsername: nick,
        status: "PENDING",
        // The buyer talked to us in the WB chat, not in a messenger of ours;
        // TG is the platform every service-owned order already uses.
        platform: "TG",
        wbCode: activationCode!,
        orderSource: "WB_DBS",
        adminNote: mark,
        pendingAt: new Date(),
        saleAmountKopecks: order.finalPriceKopecks ?? order.priceKopecks ?? undefined,
        user: order.wbCode?.userId
          ? { connect: { id: order.wbCode.userId } }
          : { connectOrCreate: { where: { tgId: "admin" }, create: { tgId: "admin", name: "Admin (DBS)" } } },
      },
    });
    // Parity with a real activation: the code is spent and cannot be redeemed
    // a second time by the buyer who still has it in their WB chat.
    await tx.wbCode.update({
      where: { id: order.wbCodeId! },
      data: {
        isUsed: true,
        status: "CLAIMED",
        usedAt: new Date(),
        ...(nick ? { robloxNick: nick } : {}),
        selectedGamepassId: preview.gamepassId,
      },
    });
    return wbOrder;
  });

  await audit(order.id, "INTERNAL_ORDER_CREATED", actor, {
    activationCode,
    gamepassId: preview.gamepassId,
    robloxUsername: nick,
    denomination,
    livePrice: preview.price,
    forced: Boolean(input.force),
  });
  return {
    ok: true,
    message: `Заказ на выкуп ${activationCode} создан: ${nick ?? "без ника"} · ${denomination} R$ · геймпасс ${preview.gamepassId}`,
    orderId: order.id,
    internalOrderId: created.id,
  };
}

async function mutateStatus(
  order: ActionOrder,
  actor: string,
  action: "confirm" | "deliver" | "receive",
): Promise<WbDeliveryActionResponse> {
  requireLiveFlag("WB_DBS_MUTATIONS_ENABLED", order);
  if (order.completedAt || order.cancelledAt) throw new WbDeliveryWorkflowError("Заказ уже закрыт", 409, "ORDER_TERMINAL");
  if (action === "deliver" && !/confirm/i.test(order.supplierStatus)) {
    throw new WbDeliveryWorkflowError("Сначала подтвердите сборку заказа", 409, "CONFIRM_REQUIRED");
  }
  if (action === "receive" && !canReceiveWbOrder({ ...order, hasLiveSecret: liveSecret(order.deliverySecret) })) {
    throw new WbDeliveryWorkflowError("Для завершения нужны: статус «в доставке», отправленный гейт и действующий код", 409, "RECEIVE_PRECONDITION");
  }

  try {
    if (!order.isTest) {
      if (action === "confirm") assertBulkOrderSucceeded(await confirmDbsOrder(order.wbOrderId), order.wbOrderId);
      if (action === "deliver") assertBulkOrderSucceeded(await deliverDbsOrder(order.wbOrderId), order.wbOrderId);
      if (action === "receive") {
        if (!order.deliverySecret) throw new WbDeliveryWorkflowError("Код доставки не найден", 409, "DELIVERY_CODE_MISSING");
        const fresh = await fetchDbsStatuses([order.wbOrderId]);
        const status = fresh.orders.find((row) => row.orderId === order.wbOrderId);
        if (!status || !/deliver/i.test(status.supplierStatus ?? "")) {
          throw new WbDeliveryWorkflowError("WB ещё не показывает заказ в статусе доставки", 409, "WB_STATUS_NOT_DELIVER");
        }
        const code = decryptWbSecret(order.deliverySecret.encryptedValue, "delivery-code");
        assertBulkOrderSucceeded(await receiveDbsOrder(order.wbOrderId, code), order.wbOrderId);
      }
    }
  } catch (error) {
    if (error instanceof WbDeliveryWorkflowError) throw error;
    const unknown = error instanceof WbDeliveryApiError && error.outcomeUnknown;
    const errorCode = unknown ? `${action.toUpperCase()}_OUTCOME_UNKNOWN` : `${action.toUpperCase()}_FAILED`;
    await db.wbMarketplaceOrder.update({ where: { id: order.id }, data: { lastErrorCode: errorCode } });
    if (action === "receive" && order.deliverySecret) {
      await db.wbDeliverySecret.update({
        where: { marketplaceOrderId: order.id },
        data: { failedAttempts: { increment: 1 } },
      }).catch(() => {});
    }
    await audit(order.id, "WB_STATUS_MUTATION_FAILED", actor, { action, outcomeUnknown: unknown });
    throw new WbDeliveryWorkflowError(
      unknown ? "WB не подтвердил результат. Выполните синхронизацию перед повтором." : "WB отклонил изменение статуса",
      502,
      errorCode,
    );
  }

  const now = new Date();
  const data = action === "confirm"
    ? { supplierStatus: "confirm", lastErrorCode: null }
    : action === "deliver"
      ? { supplierStatus: "deliver", lastErrorCode: null }
      : { supplierStatus: "receive", wbStatus: "sold", completedAt: now, lastErrorCode: null };
  await db.$transaction(async (tx) => {
    await tx.wbMarketplaceOrder.update({ where: { id: order.id }, data });
    if (action === "receive") {
      await tx.wbDeliverySecret.update({
        where: { marketplaceOrderId: order.id },
        data: { encryptedValue: "PURGED", consumedAt: now },
      });
    }
  });
  await audit(order.id, `WB_${action.toUpperCase()}_SUCCEEDED`, actor, { isTest: order.isTest });
  return {
    ok: true,
    message: action === "confirm" ? "Сборка подтверждена" : action === "deliver" ? "Заказ переведён в доставку" : "Заказ завершён, секрет удалён",
    orderId: order.id,
  };
}

export async function performWbDeliveryAction(
  actor: string,
  rawInput: unknown,
): Promise<WbDeliveryActionResponse> {
  const parsed = WbDeliveryActionSchema.safeParse(rawInput);
  if (!parsed.success) throw new WbDeliveryWorkflowError("Некорректные параметры действия", 400, "VALIDATION_ERROR");
  const input = parsed.data;
  if (input.action === "sync") {
    const sync = await runWbDeliverySync(prisma, { force: true });
    if (sync.errorCode) throw new WbDeliveryWorkflowError(`Синхронизация остановлена: ${sync.errorCode}`, 502, sync.errorCode);
    return { ok: true, message: "Данные WB синхронизированы", sync };
  }

  const order = await getOrder(input.orderId);
  if (input.action === "request_code" || input.action === "remind_code") {
    await sendText(order, wbCodeRequestMessage(), actor, "request");
    await db.wbMarketplaceOrder.update({
      where: { id: order.id },
      data: { chatState: "CODE_REQUESTED", lastErrorCode: null },
    });
    await audit(order.id, "DELIVERY_CODE_REQUESTED", actor, {
      isTest: order.isTest,
      repeat: input.action === "remind_code",
    });
    return {
      ok: true,
      message: input.action === "remind_code" ? "Запрос кода отправлен повторно" : "Инструкция с запросом кода отправлена",
      orderId: order.id,
    };
  }
  if (input.action === "save_delivery_code") {
    if (!input.code) throw new WbDeliveryWorkflowError("Введите 6-значный код", 400, "CODE_REQUIRED");
    await saveDeliveryCode(order, input.code, actor, "manual");
    return { ok: true, message: "Код доставки сохранён и скрыт", orderId: order.id };
  }
  if (input.action === "issue_gate") {
    if (!canIssueWbGate({ ...order, hasLiveSecret: liveSecret(order.deliverySecret) })) {
      throw new WbDeliveryWorkflowError("Гейт можно выпустить после получения действующего кода доставки", 409, "ISSUE_PRECONDITION");
    }
    const denomination = order.denominationSnapshot;
    if (!denomination) throw new WbDeliveryWorkflowError("Для товара не настроен номинал", 409, "MISSING_DENOMINATION");
    const issued = await db.$transaction(async (tx) => {
      const locked = await tx.wbMarketplaceOrder.findUnique({ where: { id: order.id }, include: { wbCode: true } });
      if (!locked) throw new WbDeliveryWorkflowError("Заказ не найден", 404, "ORDER_NOT_FOUND");
      if (locked.wbCode) return locked.wbCode;
      const claimed = await tx.wbMarketplaceOrder.updateMany({
        where: { id: order.id, wbCodeId: null, gateState: "NOT_ISSUED" },
        data: { gateState: "ISSUED" },
      });
      if (claimed.count !== 1) throw new WbDeliveryWorkflowError("Код уже выпускается другим оператором", 409, "ISSUE_CONFLICT");
      const code = await createUniqueCode(tx, denomination, order.isTest);
      await tx.wbMarketplaceOrder.update({ where: { id: order.id }, data: { wbCodeId: code.id } });
      return code;
    });
    await audit(order.id, "GATE_CODE_ISSUED", actor, { denomination: issued.denomination, isTest: order.isTest });
    return { ok: true, message: `Гейт ${issued.code} выпущен`, orderId: order.id };
  }
  if (input.action === "send_gate") {
    if (!order.wbCode || order.gateState !== "ISSUED") {
      throw new WbDeliveryWorkflowError("Сначала выпустите уникальный код гейта", 409, "GATE_NOT_ISSUED");
    }
    const claimed = await db.wbMarketplaceOrder.updateMany({
      where: { id: order.id, gateState: "ISSUED" },
      data: { gateState: "SENDING", lastErrorCode: null },
    });
    if (claimed.count !== 1) {
      throw new WbDeliveryWorkflowError("Отправка уже выполняется другим оператором", 409, "GATE_SEND_CONFLICT");
    }
    await audit(order.id, "GATE_SEND_STARTED", actor, { isTest: order.isTest });
    await sendText(
      order,
      wbGateMessage(order.wbCode.code, order.denominationSnapshot, GUIDE_ORIGIN),
      actor,
      "gate",
    );
    await db.wbMarketplaceOrder.update({ where: { id: order.id }, data: { gateState: "SENT", lastErrorCode: null } });
    await audit(order.id, "GATE_LINK_SENT", actor, { isTest: order.isTest });
    return { ok: true, message: "Ссылка и код отправлены покупателю", orderId: order.id };
  }
  if (input.action === "mark_served_externally") {
    if (wbGateDelivered(order.gateState)) {
      throw new WbDeliveryWorkflowError("По заказу уже отмечена выдача", 409, "ALREADY_DELIVERED");
    }
    if (order.cancelledAt) throw new WbDeliveryWorkflowError("Заказ отменён", 409, "ORDER_CANCELLED");
    await db.wbMarketplaceOrder.update({
      where: { id: order.id },
      data: { gateState: "SERVED_EXTERNALLY", lastErrorCode: null },
    });
    await audit(order.id, "GATE_SERVED_EXTERNALLY", actor, { isTest: order.isTest });
    return { ok: true, message: "Заказ закрыт как выданный вне системы", orderId: order.id };
  }
  if (input.action === "mark_gate_sent") {
    if (!order.wbCode || !["ISSUED", "SENDING", "SEND_UNKNOWN"].includes(order.gateState)) {
      throw new WbDeliveryWorkflowError("Сначала выпустите уникальный код гейта", 409, "GATE_NOT_ISSUED");
    }
    await db.wbMarketplaceOrder.update({ where: { id: order.id }, data: { gateState: "SENT", lastErrorCode: null } });
    await audit(order.id, "GATE_MANUALLY_MARKED_SENT", actor, { isTest: order.isTest });
    return { ok: true, message: "Ручная отправка зафиксирована в аудите", orderId: order.id };
  }
  if (input.action === "preview_gamepass") {
    if (!input.gamepass) throw new WbDeliveryWorkflowError("Укажите ссылку или ID геймпасса", 400, "GAMEPASS_REQUIRED");
    return { ok: true, message: "Геймпасс найден", orderId: order.id, preview: await previewGamepass(order, input.gamepass) };
  }
  if (input.action === "create_internal_order") {
    if (!input.gamepass) throw new WbDeliveryWorkflowError("Укажите ссылку или ID геймпасса", 400, "GAMEPASS_REQUIRED");
    return createInternalOrder(order, actor, {
      gamepass: input.gamepass,
      robloxUsername: input.robloxUsername,
      force: input.force,
    });
  }
  if (input.action === "send_message") {
    if (!input.message) throw new WbDeliveryWorkflowError("Введите сообщение", 400, "MESSAGE_REQUIRED");
    await sendText(order, input.message, actor, "message");
    await audit(order.id, "CHAT_MESSAGE_SENT", actor, { length: input.message.length, isTest: order.isTest });
    return { ok: true, message: "Сообщение отправлено", orderId: order.id };
  }
  return mutateStatus(order, actor, input.action);
}
