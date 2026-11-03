-- Лента «Риски» и досье покупателя (30.10.2026). Только новые таблицы, существующие не трогаем.
CREATE TABLE "RiskEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "wbCode" TEXT,
    "wbOrderId" TEXT,
    "buyerName" TEXT,
    "buyerKey" TEXT,
    "nmId" INTEGER,
    "amount" INTEGER,
    "stars" INTEGER,
    "starsBefore" INTEGER,
    "text" TEXT,
    "feedbackId" TEXT,
    "action" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    CONSTRAINT "RiskEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RiskEvent_dedupeKey_key" ON "RiskEvent"("dedupeKey");
CREATE INDEX "RiskEvent_resolvedAt_occurredAt_idx" ON "RiskEvent"("resolvedAt", "occurredAt");
CREATE INDEX "RiskEvent_wbCode_idx" ON "RiskEvent"("wbCode");
CREATE INDEX "RiskEvent_buyerKey_idx" ON "RiskEvent"("buyerKey");

CREATE TABLE "BuyerFlag" (
    "id" TEXT NOT NULL,
    "buyerKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BuyerFlag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BuyerFlag_buyerKey_key" ON "BuyerFlag"("buyerKey");
