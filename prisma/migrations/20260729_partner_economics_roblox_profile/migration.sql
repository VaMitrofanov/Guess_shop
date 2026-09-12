DO $$ BEGIN
  CREATE TYPE "PartnerRateBasis" AS ENUM ('DIRTY', 'NET');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PartnerCostBasis" AS ENUM ('ASSUMED', 'RATE', 'ACTUAL', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "robloxUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "robloxDisplayName" TEXT,
  ADD COLUMN IF NOT EXISTS "robloxAvatarUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "robloxDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "robloxAccountCreatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "robloxProfileSyncedAt" TIMESTAMP(3);

ALTER TABLE "Partner"
  ADD COLUMN IF NOT EXISTS "purchaseRateUsdtPer1000" DOUBLE PRECISION NOT NULL DEFAULT 4.7,
  ADD COLUMN IF NOT EXISTS "rateBasis" "PartnerRateBasis" NOT NULL DEFAULT 'NET',
  ADD COLUMN IF NOT EXISTS "robloxFeePct" DOUBLE PRECISION NOT NULL DEFAULT 30;

ALTER TABLE "Partner"
  ALTER COLUMN "robuxRateUsdtPer1000" SET DEFAULT 5.3;

ALTER TABLE "PartnerRateChange"
  ADD COLUMN IF NOT EXISTS "purchaseRate" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "previousPurchaseRate" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "rateBasis" "PartnerRateBasis",
  ADD COLUMN IF NOT EXISTS "previousRateBasis" "PartnerRateBasis",
  ADD COLUMN IF NOT EXISTS "robloxFeePct" DOUBLE PRECISION;

ALTER TABLE "PartnerLedgerEntry"
  ADD COLUMN IF NOT EXISTS "purchaseRateUsdtPer1000" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "rateBasis" "PartnerRateBasis",
  ADD COLUMN IF NOT EXISTS "costBasis" "PartnerCostBasis",
  ADD COLUMN IF NOT EXISTS "robloxFeePct" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "grossRobuxAmount" INTEGER,
  ADD COLUMN IF NOT EXISTS "netRobuxAmount" INTEGER,
  ADD COLUMN IF NOT EXISTS "revenueUsdt" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "expectedRevenueUsdt" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "costUsdt" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "profitUsdt" DOUBLE PRECISION;

-- Preserve what the legacy system actually charged: 5.05 was applied to the
-- gross gamepass price. Supplier cost 4.3 is owner-approved but inferred, so
-- historical rows are explicitly marked ASSUMED instead of pretending to be
-- actual supplier invoices. REFUND rows keep signed R$/money values.
UPDATE "PartnerLedgerEntry" l
SET
  "purchaseRateUsdtPer1000" = 4.3,
  "rateBasis" = 'DIRTY',
  "costBasis" = 'ASSUMED',
  "robloxFeePct" = 30,
  "grossRobuxAmount" = l."robuxAmount",
  "netRobuxAmount" = CASE
    WHEN l."robuxAmount" IS NULL THEN NULL
    WHEN l."robuxAmount" < 0 THEN -FLOOR(ABS(l."robuxAmount") * 0.7)::INTEGER
    ELSE FLOOR(l."robuxAmount" * 0.7)::INTEGER
  END,
  "revenueUsdt" = -l.amount,
  "expectedRevenueUsdt" = -l.amount,
  "costUsdt" = ROUND((COALESCE(l."robuxAmount", 0) * 4.3 / 1000.0)::NUMERIC, 2)::DOUBLE PRECISION,
  "profitUsdt" = ROUND(((-l.amount) - (COALESCE(l."robuxAmount", 0) * 4.3 / 1000.0))::NUMERIC, 2)::DOUBLE PRECISION
FROM "Partner" p
WHERE l."partnerId" = p.id
  AND p.slug = 'anton'
  AND l.type IN ('BUYOUT', 'REFUND')
  AND l."purchaseRateUsdtPer1000" IS NULL;

UPDATE "PartnerRateChange" rc
SET
  "purchaseRate" = COALESCE(rc."purchaseRate", 4.3),
  "rateBasis" = COALESCE(rc."rateBasis", 'DIRTY'),
  "robloxFeePct" = COALESCE(rc."robloxFeePct", 30)
FROM "Partner" p
WHERE rc."partnerId" = p.id AND p.slug = 'anton';

INSERT INTO "PartnerRateChange"
  (id, "partnerId", rate, "previousRate", "purchaseRate", "previousPurchaseRate",
   "rateBasis", "previousRateBasis", "robloxFeePct", "createdBy", "createdAt")
SELECT
  'anton_rate_20260729_net_53', p.id, 5.3, p."robuxRateUsdtPer1000", 4.7, 4.3,
  'NET', p."rateBasis", 30, 'migration:owner-approved-20260729', CURRENT_TIMESTAMP
FROM "Partner" p
WHERE p.slug = 'anton'
ON CONFLICT (id) DO NOTHING;

UPDATE "Partner"
SET
  "robuxRateUsdtPer1000" = 5.3,
  "purchaseRateUsdtPer1000" = 4.7,
  "rateBasis" = 'NET',
  "robloxFeePct" = 30
WHERE slug = 'anton';
