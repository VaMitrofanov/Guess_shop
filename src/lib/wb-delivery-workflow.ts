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
  canIssueWbGate,
  canReceiveWbOrder,
  wbDeliveryStage,
} from "../../bots/shared/wb-delivery-policy";
import { runWbDeliverySync } from "../../bots/shared/wb-delivery-sync";

const db = prisma;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const GUIDE_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL || "https://robloxbank.ru").replace(/\/$/, "");

const listOrderInclude = Prisma.validator<Prisma.WbMarketplaceOrderInclude>()({
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
type ListOrder = Prisma.WbMarketplaceOrderGetPayload<{ include: typeof listOrderInclude }> & {
  internalFulfillment: InternalFulfillment | null;
};
type ActionOrder = Prisma.WbMarketplaceOrderGetPayload<{ include: typeof actionOrderInclude }>;

export const WbDeliveryActionSchema = z.object({
  action: z.enum([
    "sync",
    "create_demo",
    "request_code",
    "save_delivery_code",
    "simulate_buyer_code",
    "issue_gate",
    "send_gate",
    "mark_gate_sent",
    "send_message",
    "confirm",
    "deliver",
    "receive",
  ]),
  orderId: z.string().min(1).max(80).optional(),
  code: z.string().trim().regex(/^\d{6}$/).optional(),
  message: z.string().trim().min(1).max(1_000).optional(),
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
  return Boolean(
    secret &&
    !secret.consumedAt &&
    secret.encryptedValue !== "PURGED" &&
    secret.expiresAt.getTime() > Date.now(),
  );
}

function gateUrl(code: string | null | undefined) {
  return code
    ? `${GUIDE_ORIGIN}/guide?source=wb&skip=1`
    : null;
}

function direction(sender: string): "buyer" | "seller" | "system" {
  if (/seller|supplier|manager|operator/i.test(sender)) return "seller";
  if (/system|worker/i.test(sender)) return "system";
  return "buyer";
}

function toDto(order: ListOrder): WbDeliveryOrderDto {
  const secretIsLive = liveSecret(order.deliverySecret);
  const policyOrder = { ...order, hasLiveSecret: secretIsLive };
  const chat = order.chats?.[0] ?? null;
  const activationCode = order.wbCode?.code ?? null;
  const stage = wbDeliveryStage(policyOrder);
  const chatReady = Boolean(chat?.replySignEncrypted || order.isTest);
  const terminal = Boolean(order.completedAt || order.cancelledAt);
  return {
    id: order.id,
    wbOrderId: order.wbOrderId,
    rid: order.rid,
    nmId: order.nmId,
    vendorCode: order.vendorCode,
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
    isTest: order.isTest,
    firstSeenAt: order.firstSeenAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    completedAt: iso(order.completedAt),
    cancelledAt: iso(order.cancelledAt),
    chatId: chat?.chatId ?? null,
    chatReady,
    deliveryCode: {
      present: Boolean(order.deliverySecret),
      valid: secretIsLive,
      receivedAt: iso(order.deliverySecret?.receivedAt),
      expiresAt: iso(order.deliverySecret?.expiresAt),
      consumedAt: iso(order.deliverySecret?.consumedAt),
    },
    activationCode,
    gateUrl: gateUrl(activationCode),
    fulfillment: order.internalFulfillment ?? null,
    permissions: {
      requestCode: !terminal && chatReady && !secretIsLive && order.chatState !== "REQUEST_SEND_UNKNOWN" && !order.lastErrorCode,
      saveDeliveryCode: !terminal && chatReady && wbDeliveryCryptoReady(),
      issueGate: canIssueWbGate(policyOrder),
      sendGate: !terminal && chatReady && order.gateState === "ISSUED" && Boolean(activationCode),
      markGateSent: !terminal && ["ISSUED", "SENDING", "SEND_UNKNOWN"].includes(order.gateState) && Boolean(activationCode),
      confirm: !terminal && !order.lastErrorCode && !/confirm|deliver|sold|receive/i.test(order.supplierStatus),
      deliver: !terminal && !order.lastErrorCode && /confirm/i.test(order.supplierStatus),
      receive: canReceiveWbOrder(policyOrder),
      sendMessage: !terminal && chatReady && !order.lastErrorCode,
      simulateBuyerCode: order.isTest && !terminal && !secretIsLive,
    },
    chat: (chat?.events ?? []).map((event) => ({
      id: event.id,
      sender: event.sender,
      text: event.textRedacted,
      containsDeliveryCode: event.containsDeliveryCode,
      sentAt: event.sentAt.toISOString(),
      direction: direction(event.sender),
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
    orderBy: [{ completedAt: "asc" }, { cancelledAt: "asc" }, { updatedAt: "desc" }],
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
  const dtos: WbDeliveryOrderDto[] = orders.map(toDto);
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
    metrics: {
      active: dtos.filter((order) => !order.completedAt && !order.cancelledAt).length,
      attention: dtos.filter((order) => order.stage === "attention").length,
      waitingCode: dtos.filter((order) => order.stage === "waiting_code").length,
      codeReceived: dtos.filter((order) => order.stage === "code_received").length,
      readyReceive: dtos.filter((order) => order.stage === "ready_receive").length,
      completed: dtos.filter((order) => order.stage === "complete").length,
    },
    orders: dtos,
  };
}

export async function loadWbDeliveryOrder(orderId: string): Promise<WbDeliveryOrderDto | null> {
  const order = await db.wbMarketplaceOrder.findUnique({
    where: { id: orderId },
    include: {
      ...listOrderInclude,
    },
  });
  if (!order) return null;
  const fulfillment = order.wbCode?.code
    ? await db.wbOrder.findUnique({
      where: { wbCode: order.wbCode.code },
      select: { status: true, platform: true, robloxUsername: true },
    })
    : null;
  return toDto({ ...order, internalFulfillment: fulfillment });
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

function requestCodeMessage() {
  return [
    "Здравствуйте! Чтобы завершить заказ с курьерской доставкой, откройте этот заказ в приложении Wildberries.",
    "Пришлите сюда одним сообщением 6-значный код получения, который показан в заказе.",
    "Код нужен только для завершения именно этого заказа — не публикуйте его в других чатах.",
  ].join("\n\n");
}

function gateMessage(code: string) {
  return [
    "Спасибо, код доставки получен. Теперь заберите товар через наш защищённый WB-гейт:",
    gateUrl(code)!,
    `Ваш код активации: ${code}`,
    "Дальше выберите Telegram или VK, вступите в группу и следуйте инструкции по Roblox.",
  ].join("\n\n");
}

function generateActivationCode() {
  let code = "";
  for (let i = 0; i < 7; i += 1) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

async function createUniqueCode(tx: Prisma.TransactionClient, denomination: number, isTest: boolean) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateActivationCode();
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

async function createDemo(actor: string): Promise<WbDeliveryActionResponse> {
  const product = await db.wbProductCost.findFirst({
    where: { denomination: { not: null } },
    orderBy: { updatedAt: "desc" },
  });
  const suffix = crypto.randomUUID().slice(0, 8);
  const now = new Date();
  const order = await db.wbMarketplaceOrder.create({
    data: {
      wbOrderId: `DEMO-${suffix}`,
      rid: `demo-rid-${suffix}`,
      nmId: product?.nmID ?? 0,
      vendorCode: product?.vendorCode ?? "DEMO-DBS",
      denominationSnapshot: product?.denomination ?? 500,
      priceKopecks: 149_900,
      finalPriceKopecks: 149_900,
      deliveryFrom: now,
      deliveryTo: new Date(now.getTime() + 2 * 60 * 60 * 1_000),
      supplierStatus: "new",
      wbStatus: "waiting",
      chatState: "READY",
      isTest: true,
    },
  });
  const chatId = `demo-chat-${suffix}`;
  await db.wbBuyerChat.create({
    data: { chatId, marketplaceOrderId: order.id, lastEventAt: now },
  });
  await db.wbBuyerChatEvent.create({
    data: {
      wbEventId: `demo-event-${suffix}`,
      chatId,
      marketplaceOrderId: order.id,
      eventType: "message",
      sender: "buyer",
      textRedacted: "Здравствуйте! Подскажите, как получить заказ?",
      sentAt: now,
      attachmentsMeta: {},
    },
  });
  await audit(order.id, "DEMO_CREATED", actor, { safe: true });
  return { ok: true, message: "Тестовый DBS-заказ создан", orderId: order.id };
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
  if (input.action === "create_demo") return createDemo(actor);

  const order = await getOrder(input.orderId);
  if (input.action === "request_code") {
    await sendText(order, requestCodeMessage(), actor, "request");
    await db.wbMarketplaceOrder.update({
      where: { id: order.id },
      data: { chatState: "CODE_REQUESTED", lastErrorCode: null },
    });
    await audit(order.id, "DELIVERY_CODE_REQUESTED", actor, { isTest: order.isTest });
    return { ok: true, message: "Инструкция с запросом кода отправлена", orderId: order.id };
  }
  if (input.action === "save_delivery_code") {
    if (!input.code) throw new WbDeliveryWorkflowError("Введите 6-значный код", 400, "CODE_REQUIRED");
    await saveDeliveryCode(order, input.code, actor, "manual");
    return { ok: true, message: "Код доставки сохранён и скрыт", orderId: order.id };
  }
  if (input.action === "simulate_buyer_code") {
    if (!order.isTest) throw new WbDeliveryWorkflowError("Имитация доступна только тестовому заказу", 409, "LIVE_ORDER_FORBIDDEN");
    const code = String(crypto.randomInt(100_000, 1_000_000));
    await saveDeliveryCode(order, code, actor, "demo");
    return { ok: true, message: "Тестовый покупатель прислал код", orderId: order.id };
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
    await sendText(order, gateMessage(order.wbCode.code), actor, "gate");
    await db.wbMarketplaceOrder.update({ where: { id: order.id }, data: { gateState: "SENT", lastErrorCode: null } });
    await audit(order.id, "GATE_LINK_SENT", actor, { isTest: order.isTest });
    return { ok: true, message: "Ссылка и код отправлены покупателю", orderId: order.id };
  }
  if (input.action === "mark_gate_sent") {
    if (!order.wbCode || !["ISSUED", "SENDING", "SEND_UNKNOWN"].includes(order.gateState)) {
      throw new WbDeliveryWorkflowError("Сначала выпустите уникальный код гейта", 409, "GATE_NOT_ISSUED");
    }
    await db.wbMarketplaceOrder.update({ where: { id: order.id }, data: { gateState: "SENT", lastErrorCode: null } });
    await audit(order.id, "GATE_MANUALLY_MARKED_SENT", actor, { isTest: order.isTest });
    return { ok: true, message: "Ручная отправка зафиксирована в аудите", orderId: order.id };
  }
  if (input.action === "send_message") {
    if (!input.message) throw new WbDeliveryWorkflowError("Введите сообщение", 400, "MESSAGE_REQUIRED");
    await sendText(order, input.message, actor, "message");
    await audit(order.id, "CHAT_MESSAGE_SENT", actor, { length: input.message.length, isTest: order.isTest });
    return { ok: true, message: "Сообщение отправлено", orderId: order.id };
  }
  return mutateStatus(order, actor, input.action);
}
