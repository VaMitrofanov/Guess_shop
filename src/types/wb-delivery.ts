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
 * Срез очереди DBS для главной. Считается тем же `wbDeliveryStage`, что и
 * консоль доставки, но без чатов, аудита и расшифровки секретов — экран
 * показывает числа, а не заказы.
 *
 * **«Без закрытой доставки» читается со стороны WB, а не нашей воронки.**
 * Покупатель попадает в бота только после закрытой доставки — гейт не уходит
 * раньше (`canSendWbGate`). Значит заказ «в нашем боте» доставку не держит, и
 * считать его незакрытым — врать в самом заметном месте экрана. Незакрыт тот,
 * у кого статусы WB ещё не сказали `sold / receive / complete`.
 */
export type WbDeliveryQueueSnapshot = {
  /** Всего в работе: нетерминальные заказы нашего контура. */
  open: number;
  /** Доставка реально висит на стороне WB. */
  unclosed: number;
  unclosedOldestAt: string | null;
  /** Ход за нами: проверка, полученный код, готовый гейт, незакрытый receive. */
  needsUs: number;
  needsUsOldestAt: string | null;
  /** Код у покупателя, он идёт по нашей воронке — это не задача, а процесс. */
  inBot: number;
  /** Кто должен следующий ход: `ours` / `buyer` / `bot` (WB_QUEUE_SECTIONS). */
  sections: { id: string; title: string; count: number; oldestAt: string | null }[];
  /** Этапы очереди — по ним и открывается нужная вкладка доставки. */
  stages: { stage: string; label: string; count: number; oldestAt: string | null }[];

  /* ── Срок WB ─────────────────────────────────────────────────────────────
     `deliveryTo` — обещание покупателю, данное Wildberries, а не наш возраст
     заказа. Возраст «2 д 22 ч» и «просрочено на 2 д 19 ч» — разные числа, и
     решение принимается по второму. Денег здесь нет намеренно (решение О6):
     цена в нашей базе — снимок синка и с кабинетом WB не сходится. */
  overdue: number;
  dueSoon: number;
  /** Ближайший срок среди незакрытых — по нему считается «через сколько». */
  nextDueAt: string | null;

  /** Поимённо то, что требует хода: не больше трёх строк — это дорожка, не очередь. */
  named: {
    id: string;
    wbOrderId: string;
    buyerName: string | null;
    stage: string;
    stageLabel: string;
    since: string;
    deliveryTo: string | null;
    /** Сколько раз просили код получения и когда в последний раз. */
    asked: number;
    lastAskAt: string | null;
    /** Можно ли напомнить прямо отсюда (`permissions.remindCode`). */
    canRemind: boolean;
  }[];

  /** Разложение «в боте»: одно число скрывало три разные вещи. */
  funnel: {
    /** Код открыт, ник ещё не назван — читает инструкцию. */
    instruction: number;
    /** Ник назван, ждём геймпасс. */
    nickGiven: number;
    /** Пасс есть — стоит в очереди выкупа. */
    readyBuyout: number;
    /** Гейт ушёл, а код никто не открыл: это не процесс, а потери. */
    notActivated: number;
    /** Самая старая неоткрытая отправка гейта. */
    notActivatedOldestAt: string | null;
    /** Сколько из неоткрытых уже получили оба напоминания. */
    notActivatedNudged: number;
  };

  /** Жив ли синк: все числа дорожки — снимок воркера. */
  sync: { status: string; ageSeconds: number } | null;

  /** Ориентир «сколько это обычно занимает»: закрыто за сутки и средний путь. */
  closedToday: { count: number; avgMinutes: number | null };
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
