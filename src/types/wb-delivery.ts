import type { WbDeliveryStage } from "../../bots/shared/wb-delivery-policy";

export type WbDeliveryChatEventDto = {
  id: string;
  sender: string;
  text: string | null;
  containsDeliveryCode: boolean;
  sentAt: string;
  direction: "buyer" | "seller" | "system";
};

export type WbDeliveryAuditDto = {
  id: string;
  type: string;
  actor: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type WbDeliveryOrderDto = {
  id: string;
  wbOrderId: string;
  rid: string | null;
  nmId: number;
  vendorCode: string | null;
  denomination: number | null;
  priceKopecks: number | null;
  finalPriceKopecks: number | null;
  deliveryFrom: string | null;
  deliveryTo: string | null;
  supplierStatus: string;
  wbStatus: string;
  chatState: string;
  gateState: string;
  stage: WbDeliveryStage;
  lastErrorCode: string | null;
  isTest: boolean;
  firstSeenAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  chatId: string | null;
  chatReady: boolean;
  deliveryCode: {
    present: boolean;
    valid: boolean;
    value: string | null;
    receivedAt: string | null;
    expiresAt: string | null;
    consumedAt: string | null;
  };
  activationCode: string | null;
  gateUrl: string | null;
  fulfillment: {
    status: string;
    platform: string | null;
    robloxUsername: string | null;
  } | null;
  /** Human-readable reason the next provider action is unavailable, or null
   * when nothing blocks it. Rendered verbatim by both consoles. */
  blockedReason: string | null;
  permissions: {
    requestCode: boolean;
    remindCode: boolean;
    saveDeliveryCode: boolean;
    issueGate: boolean;
    sendGate: boolean;
    markGateSent: boolean;
    confirm: boolean;
    deliver: boolean;
    receive: boolean;
    sendMessage: boolean;
    simulateBuyerCode: boolean;
  };
  chat: WbDeliveryChatEventDto[];
  audit: WbDeliveryAuditDto[];
};

export type WbDeliveryOverview = {
  generatedAt: string;
  environment: {
    syncEnabled: boolean;
    chatSendEnabled: boolean;
    mutationsEnabled: boolean;
    cryptoReady: boolean;
    marketplaceApiReady: boolean;
    chatApiReady: boolean;
    scopedMarketplaceToken: boolean;
    scopedChatToken: boolean;
    workerStatus: string;
    workerLastSeenAt: string | null;
    workerError: string | null;
  };
  metrics: {
    active: number;
    attention: number;
    waitingCode: number;
    codeReceived: number;
    readyReceive: number;
    completed: number;
  };
  orders: WbDeliveryOrderDto[];
};

export type WbDeliveryOrderResponse = {
  generatedAt: string;
  order: WbDeliveryOrderDto;
};

export type WbDeliveryAction =
  | "sync"
  | "create_demo"
  | "request_code"
  | "remind_code"
  | "save_delivery_code"
  | "simulate_buyer_code"
  | "issue_gate"
  | "send_gate"
  | "mark_gate_sent"
  | "send_message"
  | "confirm"
  | "deliver"
  | "receive";

export type WbDeliveryActionResponse = {
  ok: true;
  message: string;
  orderId?: string;
  sync?: Record<string, unknown>;
};
