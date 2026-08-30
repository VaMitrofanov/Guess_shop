import type { WbDeliveryStage, WbFunnelStep } from "../../bots/shared/wb-delivery-policy";

export type WbDeliveryChatEventDto = {
  id: string;
  sender: string;
  text: string | null;
  containsDeliveryCode: boolean;
  sentAt: string;
  direction: "buyer" | "seller" | "system";
  /** Locally mirrored, not yet echoed back by WB. */
  pending: boolean;
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
  /** Buyer's first name from the WB DBS client endpoint, or null while WB has
   * not served it. The only buyer identity this system stores. */
  buyerName: string | null;
  /** Where the buyer stands in our own funnel once the gate is out — the detail
   * the single `in_bot` stage used to hide. */
  funnelStep: WbFunnelStep;
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
  firstSeenAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  chatId: string | null;
  chatReady: boolean;
  deliveryCode: {
    present: boolean;
    valid: boolean;
    /** Plaintext only on the single-order response; always null in the list. */
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
    /** `false`, пока за заказом стоит служебный аккаунт, а не человек. */
    buyerLinked?: boolean;
    /** `@username` / `tg:…` / `vk:…` — то, чем оператор может воспользоваться. */
    buyerHandle?: string | null;
  } | null;
  /** WB closed the order but the buyer never received a gate code — money
   * settled, nothing delivered. The loudest state the console can show. */
  unserved: boolean;
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
    markServedExternally: boolean;
    /** Выкуп открыт вручную и висит на служебном аккаунте — покупателя надо
     * привязать, иначе он не получит ни уведомлений, ни «Мой заказ». */
    linkBuyer: boolean;
    /** The gate code exists but nobody activated it, so an operator may open
     * the buyout order by hand. */
    createInternalOrder: boolean;
    confirm: boolean;
    deliver: boolean;
    receive: boolean;
    sendMessage: boolean;
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
  /** All derived from `stage`, so a counter and the queue it opens always agree. */
  metrics: {
    active: number;
    urgent: number;
    attention: number;
    waitingCode: number;
    codeReceived: number;
    readyReceive: number;
    inBot: number;
    completed: number;
  };
  orders: WbDeliveryOrderDto[];
};

/**
 * Срез очереди DBS для главной: «сколько висит без закрытой доставки и на каком
 * этапе». Считается тем же `wbDeliveryStage`, что и консоль доставки, но без
 * чатов, аудита и расшифровки секретов — экран показывает числа, а не заказы.
 *
 * «Без закрытой доставки» = этап не `complete` и не `cancelled`: доставку
 * закрывает наш вызов `receive`, и до него обязательство перед покупателем
 * висит независимо от того, что показывает кабинет WB.
 */
export type WbDeliveryQueueSnapshot = {
  open: number;
  /** Самый старый открытый заказ — по времени заказа у WB, не по нашему первому взгляду. */
  oldestAt: string | null;
  /** Кто должен следующий ход: `ours` / `buyer` / `bot` (WB_QUEUE_SECTIONS). */
  sections: { id: string; title: string; count: number; oldestAt: string | null }[];
  /** Этапы внутри «Наш ход» — по ним и открывается нужная очередь. */
  stages: { stage: string; label: string; count: number; oldestAt: string | null }[];
};

export type WbDeliveryOrderResponse = {
  generatedAt: string;
  order: WbDeliveryOrderDto;
};

export type WbDeliveryAction =
  | "sync"
  | "request_code"
  | "remind_code"
  | "save_delivery_code"
  | "issue_gate"
  | "send_gate"
  | "mark_gate_sent"
  | "mark_served_externally"
  | "link_buyer"
  | "send_message"
  | "confirm"
  | "deliver"
  | "receive"
  | "preview_gamepass"
  | "create_internal_order";

/** What the console learned about a game pass before an operator commits to
 * opening a buyout order on it. */
export type WbGamepassPreview = {
  gamepassId: string;
  gamepassUrl: string;
  name: string;
  /** Owner of the pass — the Roblox nick the buyout will be delivered to. */
  robloxUsername: string;
  price: number;
  basePrice: number;
  isForSale: boolean;
  denomination: number | null;
  /** What this denomination should cost at our 70% rate. */
  expectedPrice: number | null;
  priceOk: boolean;
  duplicate: { wbCode: string; status: string; orderSource: string } | null;
};

export type WbDeliveryActionResponse = {
  ok: true;
  message: string;
  orderId?: string;
  sync?: Record<string, unknown>;
  preview?: WbGamepassPreview;
  /** Id of the freshly created buyout order, for a direct jump to «Заказы». */
  internalOrderId?: string;
};
