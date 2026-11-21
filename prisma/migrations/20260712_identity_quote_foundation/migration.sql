-- Identity, ledger and quote foundation for the unified retail storefront.
--
-- This migration is additive. It does not merge profiles, alter existing
-- balances or enable payments: it only backfills verifiable legacy keys and
-- records the current balance as one immutable opening ledger entry.

CREATE TYPE "UserIdentityProvider" AS ENUM ('TG', 'VK', 'EMAIL');
CREATE TYPE "PriceQuoteStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED', 'VOID');

CREATE TABLE "UserIdentity" (
    "id" TEXT NOT NULL,
    "provider" "UserIdentityProvider" NOT NULL,
    "subject" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BonusLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deltaRobux" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "referenceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BonusLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountMergeAudit" (
    "id" TEXT NOT NULL,
    "sourceUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "evidence" JSONB NOT NULL,
    "result" JSONB,
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccountMergeAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PricingPolicy" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PricingPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PriceQuote" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "policyId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "requestedRobux" INTEGER NOT NULL,
    "bonusRobux" INTEGER NOT NULL DEFAULT 0,
    "baseAmountKopecks" INTEGER NOT NULL,
    "discountKopecks" INTEGER NOT NULL DEFAULT 0,
    "finalAmountKopecks" INTEGER NOT NULL,
    "status" "PriceQuoteStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "contextHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PriceQuote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserIdentity_provider_subject_key" ON "UserIdentity"("provider", "subject");
CREATE UNIQUE INDEX "UserIdentity_userId_provider_key" ON "UserIdentity"("userId", "provider");
CREATE INDEX "UserIdentity_userId_idx" ON "UserIdentity"("userId");
CREATE UNIQUE INDEX "BonusLedger_idempotencyKey_key" ON "BonusLedger"("idempotencyKey");
CREATE INDEX "BonusLedger_userId_createdAt_idx" ON "BonusLedger"("userId", "createdAt" DESC);
CREATE INDEX "BonusLedger_referenceId_idx" ON "BonusLedger"("referenceId");
CREATE INDEX "AccountMergeAudit_sourceUserId_createdAt_idx" ON "AccountMergeAudit"("sourceUserId", "createdAt" DESC);
CREATE INDEX "AccountMergeAudit_targetUserId_createdAt_idx" ON "AccountMergeAudit"("targetUserId", "createdAt" DESC);
CREATE UNIQUE INDEX "PricingPolicy_version_key" ON "PricingPolicy"("version");
CREATE INDEX "PricingPolicy_isActive_validFrom_idx" ON "PricingPolicy"("isActive", "validFrom");
CREATE INDEX "PriceQuote_userId_status_expiresAt_idx" ON "PriceQuote"("userId", "status", "expiresAt");
CREATE INDEX "PriceQuote_policyId_createdAt_idx" ON "PriceQuote"("policyId", "createdAt" DESC);

ALTER TABLE "UserIdentity"
  ADD CONSTRAINT "UserIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BonusLedger"
  ADD CONSTRAINT "BonusLedger_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountMergeAudit"
  ADD CONSTRAINT "AccountMergeAudit_sourceUserId_fkey"
  FOREIGN KEY ("sourceUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountMergeAudit"
  ADD CONSTRAINT "AccountMergeAudit_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceQuote"
  ADD CONSTRAINT "PriceQuote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PriceQuote"
  ADD CONSTRAINT "PriceQuote_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "PricingPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill only verified, pre-existing platform identifiers. Conflicts are
-- deliberately skipped and must be inspected before any account merge.
INSERT INTO "UserIdentity" ("id", "provider", "subject", "userId", "verifiedAt", "createdAt", "updatedAt")
SELECT 'backfill:' || "id" || ':TG', 'TG', "tgId", "id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User"
WHERE "tgId" IS NOT NULL
ON CONFLICT ("provider", "subject") DO NOTHING;

INSERT INTO "UserIdentity" ("id", "provider", "subject", "userId", "verifiedAt", "createdAt", "updatedAt")
SELECT 'backfill:' || "id" || ':VK', 'VK', "vkId", "id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User"
WHERE "vkId" IS NOT NULL
ON CONFLICT ("provider", "subject") DO NOTHING;

INSERT INTO "UserIdentity" ("id", "provider", "subject", "userId", "verifiedAt", "createdAt", "updatedAt")
SELECT 'backfill:' || "id" || ':EMAIL', 'EMAIL', LOWER("email"), "id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User"
WHERE "email" IS NOT NULL
ON CONFLICT ("provider", "subject") DO NOTHING;

-- A WbOrder nickname has already passed the order validation flow. Only fill
-- an empty profile field from the most recently updated such order; never
-- overwrite a nickname the customer already confirmed on their User profile.
WITH latest_confirmed_nick AS (
  SELECT DISTINCT ON ("userId") "userId", "robloxUsername"
  FROM "WbOrder"
  WHERE "robloxUsername" IS NOT NULL AND BTRIM("robloxUsername") <> ''
  ORDER BY "userId", "updatedAt" DESC
)
UPDATE "User" AS u
SET "robloxUsername" = n."robloxUsername"
FROM latest_confirmed_nick AS n
WHERE u."id" = n."userId" AND u."robloxUsername" IS NULL;

INSERT INTO "BonusLedger" ("id", "userId", "deltaRobux", "balanceAfter", "reason", "idempotencyKey", "createdAt")
SELECT
  'backfill:balance:' || "id",
  "id",
  "balance",
  "balance",
  'LEGACY_BALANCE_BACKFILL',
  'legacy-balance:' || "id",
  CURRENT_TIMESTAMP
FROM "User"
WHERE "balance" <> 0
ON CONFLICT ("idempotencyKey") DO NOTHING;

INSERT INTO "PricingPolicy" ("id", "version", "definition", "isActive", "validFrom", "createdAt", "updatedAt")
VALUES (
  'retail-direct-v1',
  'retail-direct-v1',
  '{"currency":"RUB","customMin":100,"customMax":100000,"smallOrderSurchargeRub":60,"tiers":[{"from":100,"to":499,"rubPerRobux":1},{"from":500,"to":999,"rubPerRobux":0.9},{"from":1000,"to":1499,"rubPerRobux":0.8},{"from":1500,"rubPerRobux":0.7}],"packs":{"100":160,"200":260,"300":360,"400":460,"500":450,"800":720,"1000":800,"1200":960,"1500":1050,"2000":1400}}'::jsonb,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("version") DO NOTHING;
