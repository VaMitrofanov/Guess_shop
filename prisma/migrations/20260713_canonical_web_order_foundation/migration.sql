-- Canonical SITE/WEB order and payment foundation. This migration is additive
-- for historical bot/WB rows; all new columns on WbOrder are nullable.
ALTER TYPE "Platform" ADD VALUE IF NOT EXISTS 'WEB';
ALTER TYPE "OrderSource" ADD VALUE IF NOT EXISTS 'SITE';

CREATE TYPE "PaymentAttemptStatus" AS ENUM (
  'CREATED', 'INITIATED', 'AUTHORIZED', 'CONFIRMED',
  'REJECTED', 'CANCELED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED'
);
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'DEAD');

ALTER TABLE "WbOrder"
  ADD COLUMN "priceQuoteId" TEXT,
  ADD COLUMN "publicOrderId" TEXT,
  ADD COLUMN "statusTokenHash" TEXT,
  ADD COLUMN "paymentAmountKopecks" INTEGER,
  ADD COLUMN "receiptEmail" TEXT,
  ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "termsVersion" TEXT,
  ADD COLUMN "termsIpAddress" TEXT,
  ADD COLUMN "webIdempotencyKey" TEXT;

CREATE TABLE "PaymentAttempt" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "publicOrderId" TEXT NOT NULL,
  "paymentId" TEXT,
  "amountKopecks" INTEGER NOT NULL,
  "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
  "idempotencyKey" TEXT NOT NULL,
  "paymentUrl" TEXT,
  "rawEventHash" TEXT,
  "initiatedAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderEvent" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutboxMessage" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WbOrder_priceQuoteId_key" ON "WbOrder"("priceQuoteId");
CREATE UNIQUE INDEX "WbOrder_publicOrderId_key" ON "WbOrder"("publicOrderId");
CREATE UNIQUE INDEX "WbOrder_statusTokenHash_key" ON "WbOrder"("statusTokenHash");
CREATE UNIQUE INDEX "WbOrder_webIdempotencyKey_key" ON "WbOrder"("webIdempotencyKey");
CREATE INDEX "WbOrder_publicOrderId_idx" ON "WbOrder"("publicOrderId");

CREATE UNIQUE INDEX "PaymentAttempt_publicOrderId_key" ON "PaymentAttempt"("publicOrderId");
CREATE UNIQUE INDEX "PaymentAttempt_paymentId_key" ON "PaymentAttempt"("paymentId");
CREATE UNIQUE INDEX "PaymentAttempt_idempotencyKey_key" ON "PaymentAttempt"("idempotencyKey");
CREATE INDEX "PaymentAttempt_orderId_createdAt_idx" ON "PaymentAttempt"("orderId", "createdAt" DESC);
CREATE INDEX "PaymentAttempt_provider_status_updatedAt_idx" ON "PaymentAttempt"("provider", "status", "updatedAt");

CREATE UNIQUE INDEX "OrderEvent_idempotencyKey_key" ON "OrderEvent"("idempotencyKey");
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");
CREATE UNIQUE INDEX "OutboxMessage_eventId_key" ON "OutboxMessage"("eventId");
CREATE INDEX "OutboxMessage_status_nextAttemptAt_idx" ON "OutboxMessage"("status", "nextAttemptAt");

ALTER TABLE "WbOrder" ADD CONSTRAINT "WbOrder_priceQuoteId_fkey"
  FOREIGN KEY ("priceQuoteId") REFERENCES "PriceQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "WbOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "WbOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "OrderEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
