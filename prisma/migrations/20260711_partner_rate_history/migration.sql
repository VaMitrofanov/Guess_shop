-- Этап 5.9 Блок A: структурная фиксация курса для отчётов.
-- 1) BUYOUT-списания хранят курс и R$ структурно (раньше — только текстом в comment).
-- 2) PartnerRateChange — журнал смен курса (кто/когда/с какого на какой).

ALTER TABLE "PartnerLedgerEntry" ADD COLUMN "rateUsdtPer1000" DOUBLE PRECISION;
ALTER TABLE "PartnerLedgerEntry" ADD COLUMN "robuxAmount" INTEGER;

CREATE TABLE "PartnerRateChange" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "rate" DOUBLE PRECISION NOT NULL,
  "previousRate" DOUBLE PRECISION,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PartnerRateChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PartnerRateChange_partnerId_createdAt_idx"
  ON "PartnerRateChange"("partnerId", "createdAt" DESC);

ALTER TABLE "PartnerRateChange"
  ADD CONSTRAINT "PartnerRateChange_partnerId_fkey"
  FOREIGN KEY ("partnerId") REFERENCES "Partner"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
