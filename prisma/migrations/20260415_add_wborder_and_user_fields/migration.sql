-- Migration: add WbOrder table, Platform/WbOrderStatus enums,
-- and missing User/WbCode columns introduced after the initial migration.
-- All statements use IF NOT EXISTS / DO $$ guards so they are safe to run
-- against a DB that was previously synced with `prisma db push`.

-- ── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "Platform" AS ENUM ('VK', 'TG');
EXCEPTION WHEN duplicate_object THEN
  -- enum already exists; add any missing values just in case
  BEGIN
    ALTER TYPE "Platform" ADD VALUE IF NOT EXISTS 'VK';
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    ALTER TYPE "Platform" ADD VALUE IF NOT EXISTS 'TG';
  EXCEPTION WHEN others THEN NULL; END;
END $$;

DO $$ BEGIN
  CREATE TYPE "WbOrderStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN
  BEGIN
    ALTER TYPE "WbOrderStatus" ADD VALUE IF NOT EXISTS 'PENDING';
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    ALTER TYPE "WbOrderStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    ALTER TYPE "WbOrderStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
  EXCEPTION WHEN others THEN NULL; END;
END $$;

-- ── User — missing columns ────────────────────────────────────────────────────

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "vkId"               TEXT,
  ADD COLUMN IF NOT EXISTS "tgId"               TEXT,
  ADD COLUMN IF NOT EXISTS "image"              TEXT,
  ADD COLUMN IF NOT EXISTS "balance"            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "reviewBonusClaimed" BOOLEAN NOT NULL DEFAULT false;

-- email was NOT NULL in the init migration; make it nullable to support
-- bot-only users (registered via VK/TG without an email).
ALTER TABLE "User"
  ALTER COLUMN "email"    DROP NOT NULL,
  ALTER COLUMN "password" DROP NOT NULL,
  ALTER COLUMN "role"     SET DEFAULT 'USER';

-- Unique indexes (CREATE UNIQUE INDEX … IF NOT EXISTS requires PG 9.5+)
CREATE UNIQUE INDEX IF NOT EXISTS "User_vkId_key" ON "User"("vkId");
CREATE UNIQUE INDEX IF NOT EXISTS "User_tgId_key" ON "User"("tgId");
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");  -- already exists, IF NOT EXISTS is safe

-- ── WbCode — missing columns ──────────────────────────────────────────────────

ALTER TABLE "WbCode"
  ADD COLUMN IF NOT EXISTS "reviewBonusClaimed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "userId"             TEXT;

CREATE INDEX IF NOT EXISTS "WbCode_userId_idx" ON "WbCode"("userId");

ALTER TABLE "WbCode"
  ADD CONSTRAINT IF NOT EXISTS "WbCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Order — missing columns added after init ──────────────────────────────────

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "userId" TEXT;

ALTER TABLE "Order"
  ADD CONSTRAINT IF NOT EXISTS "Order_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── WbOrder — full table ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "WbOrder" (
    "id"              TEXT          NOT NULL,
    "amount"          INTEGER       NOT NULL,
    "gamepassUrl"     TEXT          NOT NULL,
    "status"          "WbOrderStatus" NOT NULL DEFAULT 'PENDING',
    "platform"        "Platform"    NOT NULL,
    "userId"          TEXT          NOT NULL,
    "wbCode"          TEXT          NOT NULL,
    "adminId"         TEXT,
    "rejectionReason" TEXT,
    "createdAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WbOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WbOrder_userId_idx"  ON "WbOrder"("userId");
CREATE INDEX IF NOT EXISTS "WbOrder_status_idx"  ON "WbOrder"("status");
CREATE INDEX IF NOT EXISTS "WbOrder_wbCode_idx"  ON "WbOrder"("wbCode");

ALTER TABLE "WbOrder"
  ADD CONSTRAINT IF NOT EXISTS "WbOrder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- In case the table existed from a previous db push but is missing rejectionReason:
ALTER TABLE "WbOrder"
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;

-- ── MarketRate ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "MarketRate" (
    "id"        TEXT          NOT NULL,
    "provider"  TEXT          NOT NULL,
    "rateUSD"   DOUBLE PRECISION NOT NULL,
    "inventory" INTEGER       NOT NULL,
    "maxLimit"  INTEGER       NOT NULL,
    "updatedAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MarketRate_provider_key" ON "MarketRate"("provider");
CREATE INDEX        IF NOT EXISTS "MarketRate_provider_idx" ON "MarketRate"("provider");

-- ── GlobalSettings ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "GlobalSettings" (
    "id"          TEXT             NOT NULL DEFAULT 'global',
    "usdToRub"    DOUBLE PRECISION NOT NULL,
    "lastUpdated" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlobalSettings_pkey" PRIMARY KEY ("id")
);
