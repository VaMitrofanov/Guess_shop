-- Partner buyout bounded context. These tables intentionally do not reference
-- WbOrder: B2B partner tasks are separate from customer WB/DIRECT/AVITO orders.

CREATE TYPE "PartnerTaskStatus" AS ENUM (
  'NEW',
  'READY',
  'PURCHASING',
  'DONE',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE "PartnerLedgerType" AS ENUM (
  'TOPUP',
  'BUYOUT',
  'ADJUSTMENT',
  'REFUND'
);

CREATE TYPE "PartnerExternalSource" AS ENUM (
  'MANUAL',
  'GOOGLE_SHEETS'
);

CREATE TABLE "Partner" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerBuyoutTask" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "externalRowId" TEXT,
  "externalSource" "PartnerExternalSource" NOT NULL DEFAULT 'MANUAL',
  "status" "PartnerTaskStatus" NOT NULL DEFAULT 'NEW',
  "robloxUsername" TEXT,
  "gamepassId" TEXT,
  "gamepassUrl" TEXT,
  "productId" TEXT,
  "sellerId" TEXT,
  "sellerName" TEXT,
  "priceRobux" INTEGER,
  "purchasePriceRobux" INTEGER,
  "sheetRaw" JSONB,
  "purchaseAccountName" TEXT,
  "purchaseBatchId" TEXT,
  "completedAt" TIMESTAMP(3),
  "error" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PartnerBuyoutTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PartnerLedgerEntry" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "taskId" TEXT,
  "type" "PartnerLedgerType" NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'R$',
  "reference" TEXT,
  "comment" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PartnerLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Partner_slug_key" ON "Partner"("slug");
CREATE UNIQUE INDEX "PartnerBuyoutTask_partnerId_externalSource_externalRowId_key"
  ON "PartnerBuyoutTask"("partnerId", "externalSource", "externalRowId");
CREATE INDEX "PartnerBuyoutTask_partnerId_status_idx" ON "PartnerBuyoutTask"("partnerId", "status");
CREATE INDEX "PartnerBuyoutTask_partnerId_updatedAt_idx" ON "PartnerBuyoutTask"("partnerId", "updatedAt" DESC);
CREATE INDEX "PartnerBuyoutTask_gamepassId_idx" ON "PartnerBuyoutTask"("gamepassId");
CREATE INDEX "PartnerBuyoutTask_purchaseBatchId_idx" ON "PartnerBuyoutTask"("purchaseBatchId");
CREATE INDEX "PartnerLedgerEntry_partnerId_createdAt_idx" ON "PartnerLedgerEntry"("partnerId", "createdAt" DESC);
CREATE INDEX "PartnerLedgerEntry_taskId_idx" ON "PartnerLedgerEntry"("taskId");

ALTER TABLE "PartnerBuyoutTask"
  ADD CONSTRAINT "PartnerBuyoutTask_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "Partner"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartnerLedgerEntry"
  ADD CONSTRAINT "PartnerLedgerEntry_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "Partner"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartnerLedgerEntry"
  ADD CONSTRAINT "PartnerLedgerEntry_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "PartnerBuyoutTask"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
