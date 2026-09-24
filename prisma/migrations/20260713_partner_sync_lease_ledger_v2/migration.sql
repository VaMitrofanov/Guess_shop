-- Prevent overlapping manual/background Google Sheets syncs across web instances.
ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS "googleSyncLeaseId" TEXT,
  ADD COLUMN IF NOT EXISTS "googleSyncLeaseAt" TIMESTAMP(3);

-- Ledger v2 stores one BUYOUT row per actual purchase batch.
ALTER TABLE "PartnerLedgerEntry"
  ADD COLUMN IF NOT EXISTS "purchaseAccountName" TEXT,
  ADD COLUMN IF NOT EXISTS "batchId" TEXT,
  ADD COLUMN IF NOT EXISTS "itemCount" INTEGER NOT NULL DEFAULT 1;

UPDATE "PartnerLedgerEntry" AS ledger
SET "purchaseAccountName" = task."purchaseAccountName"
FROM "PartnerBuyoutTask" AS task
WHERE ledger."taskId" = task."id"
  AND ledger."type" = 'BUYOUT'
  AND ledger."purchaseAccountName" IS NULL
  AND task."purchaseAccountName" IS NOT NULL;

UPDATE "PartnerLedgerEntry"
SET "batchId" = 'legacy:' || "id"
WHERE "type" = 'BUYOUT'
  AND "batchId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "PartnerLedgerEntry_partnerId_batchId_key"
  ON "PartnerLedgerEntry"("partnerId", "batchId");
