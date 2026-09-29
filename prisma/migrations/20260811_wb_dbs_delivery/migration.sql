-- WB DBS marketplace delivery foundation. Additive only: legacy WbCode/WbOrder
-- rows are not rewritten, and all new foreign keys are nullable where needed.

CREATE TYPE "WbMarketplaceChatState" AS ENUM (
  'WAITING_BUYER_CHAT',
  'READY',
  'CODE_REQUESTED',
  'REQUEST_SEND_UNKNOWN',
  'CODE_RECEIVED'
);

CREATE TYPE "WbMarketplaceGateState" AS ENUM (
  'NOT_ISSUED',
  'ISSUED',
  'SENDING',
  'SENT',
  'SEND_UNKNOWN',
  'REVOKED'
);

CREATE TABLE "WbMarketplaceOrder" (
  "id" TEXT NOT NULL,
  "wbOrderId" TEXT NOT NULL,
  "fulfillmentModel" TEXT NOT NULL DEFAULT 'DBS',
  "rid" TEXT,
  "orderUid" TEXT,
  "groupId" TEXT,
  "nmId" INTEGER NOT NULL,
  "vendorCode" TEXT,
  "article" TEXT,
  "denominationSnapshot" INTEGER,
  "priceKopecks" INTEGER,
  "finalPriceKopecks" INTEGER,
  "currencyCode" INTEGER,
  "deliveryFrom" TIMESTAMP(3),
  "deliveryTo" TIMESTAMP(3),
  "requiredMeta" JSONB,
  "supplierStatus" TEXT NOT NULL DEFAULT 'new',
  "wbStatus" TEXT NOT NULL DEFAULT 'waiting',
  "chatState" "WbMarketplaceChatState" NOT NULL DEFAULT 'WAITING_BUYER_CHAT',
  "gateState" "WbMarketplaceGateState" NOT NULL DEFAULT 'NOT_ISSUED',
  "wbCodeId" TEXT,
  "lastErrorCode" TEXT,
  "isTest" BOOLEAN NOT NULL DEFAULT false,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WbMarketplaceOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WbBuyerChat" (
  "chatId" TEXT NOT NULL,
  "marketplaceOrderId" TEXT,
  "replySignEncrypted" TEXT,
  "lastEventAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WbBuyerChat_pkey" PRIMARY KEY ("chatId")
);

CREATE TABLE "WbBuyerChatEvent" (
  "id" TEXT NOT NULL,
  "wbEventId" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "marketplaceOrderId" TEXT,
  "eventType" TEXT NOT NULL,
  "sender" TEXT NOT NULL,
  "textRedacted" TEXT,
  "containsDeliveryCode" BOOLEAN NOT NULL DEFAULT false,
  "isNewChat" BOOLEAN NOT NULL DEFAULT false,
  "sentAt" TIMESTAMP(3) NOT NULL,
  "attachmentsMeta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WbBuyerChatEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WbDeliverySecret" (
  "marketplaceOrderId" TEXT NOT NULL,
  "encryptedValue" TEXT NOT NULL,
  "codeHmac" TEXT NOT NULL,
  "keyVersion" TEXT NOT NULL DEFAULT 'v1',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WbDeliverySecret_pkey" PRIMARY KEY ("marketplaceOrderId")
);

CREATE TABLE "WbSyncCursor" (
  "stream" TEXT NOT NULL,
  "cursor" TEXT,
  "leaseId" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WbSyncCursor_pkey" PRIMARY KEY ("stream")
);

CREATE TABLE "WbMarketplaceEvent" (
  "id" TEXT NOT NULL,
  "marketplaceOrderId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WbMarketplaceEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WbMarketplaceOrder_wbOrderId_key" ON "WbMarketplaceOrder"("wbOrderId");
CREATE UNIQUE INDEX "WbMarketplaceOrder_rid_key" ON "WbMarketplaceOrder"("rid");
CREATE UNIQUE INDEX "WbMarketplaceOrder_wbCodeId_key" ON "WbMarketplaceOrder"("wbCodeId");
CREATE INDEX "WbMarketplaceOrder_supplierStatus_updatedAt_idx" ON "WbMarketplaceOrder"("supplierStatus", "updatedAt" DESC);
CREATE INDEX "WbMarketplaceOrder_wbStatus_updatedAt_idx" ON "WbMarketplaceOrder"("wbStatus", "updatedAt" DESC);
CREATE INDEX "WbMarketplaceOrder_chatState_gateState_updatedAt_idx" ON "WbMarketplaceOrder"("chatState", "gateState", "updatedAt" DESC);
CREATE INDEX "WbMarketplaceOrder_nmId_createdAt_idx" ON "WbMarketplaceOrder"("nmId", "createdAt" DESC);
CREATE INDEX "WbMarketplaceOrder_isTest_deliveryTo_idx" ON "WbMarketplaceOrder"("isTest", "deliveryTo");
CREATE INDEX "WbBuyerChat_marketplaceOrderId_lastEventAt_idx" ON "WbBuyerChat"("marketplaceOrderId", "lastEventAt" DESC);
CREATE INDEX "WbBuyerChat_lastEventAt_idx" ON "WbBuyerChat"("lastEventAt" DESC);
CREATE UNIQUE INDEX "WbBuyerChatEvent_wbEventId_key" ON "WbBuyerChatEvent"("wbEventId");
CREATE INDEX "WbBuyerChatEvent_chatId_sentAt_idx" ON "WbBuyerChatEvent"("chatId", "sentAt" DESC);
CREATE INDEX "WbBuyerChatEvent_marketplaceOrderId_sentAt_idx" ON "WbBuyerChatEvent"("marketplaceOrderId", "sentAt" DESC);
CREATE INDEX "WbDeliverySecret_expiresAt_consumedAt_idx" ON "WbDeliverySecret"("expiresAt", "consumedAt");
CREATE INDEX "WbSyncCursor_leaseUntil_idx" ON "WbSyncCursor"("leaseUntil");
CREATE INDEX "WbSyncCursor_lastSuccessAt_idx" ON "WbSyncCursor"("lastSuccessAt");
CREATE UNIQUE INDEX "WbMarketplaceEvent_idempotencyKey_key" ON "WbMarketplaceEvent"("idempotencyKey");
CREATE INDEX "WbMarketplaceEvent_marketplaceOrderId_createdAt_idx" ON "WbMarketplaceEvent"("marketplaceOrderId", "createdAt" DESC);
CREATE INDEX "WbMarketplaceEvent_type_createdAt_idx" ON "WbMarketplaceEvent"("type", "createdAt" DESC);

ALTER TABLE "WbMarketplaceOrder" ADD CONSTRAINT "WbMarketplaceOrder_wbCodeId_fkey"
  FOREIGN KEY ("wbCodeId") REFERENCES "WbCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WbBuyerChat" ADD CONSTRAINT "WbBuyerChat_marketplaceOrderId_fkey"
  FOREIGN KEY ("marketplaceOrderId") REFERENCES "WbMarketplaceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WbBuyerChatEvent" ADD CONSTRAINT "WbBuyerChatEvent_chatId_fkey"
  FOREIGN KEY ("chatId") REFERENCES "WbBuyerChat"("chatId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WbBuyerChatEvent" ADD CONSTRAINT "WbBuyerChatEvent_marketplaceOrderId_fkey"
  FOREIGN KEY ("marketplaceOrderId") REFERENCES "WbMarketplaceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WbDeliverySecret" ADD CONSTRAINT "WbDeliverySecret_marketplaceOrderId_fkey"
  FOREIGN KEY ("marketplaceOrderId") REFERENCES "WbMarketplaceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WbMarketplaceEvent" ADD CONSTRAINT "WbMarketplaceEvent_marketplaceOrderId_fkey"
  FOREIGN KEY ("marketplaceOrderId") REFERENCES "WbMarketplaceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
