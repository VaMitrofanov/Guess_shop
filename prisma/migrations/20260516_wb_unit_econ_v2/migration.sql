-- Add denomination and adCostPerUnit to WbProductCost
ALTER TABLE "WbProductCost" ADD COLUMN IF NOT EXISTS "denomination" INTEGER;
ALTER TABLE "WbProductCost" ADD COLUMN IF NOT EXISTS "adCostPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0;
-- Change logisticsCost from INT to FLOAT (safe cast)
ALTER TABLE "WbProductCost" ALTER COLUMN "logisticsCost" TYPE DOUBLE PRECISION USING "logisticsCost"::DOUBLE PRECISION;
-- Update defaults for existing rows to match new formula
UPDATE "WbProductCost" SET "wbCommission" = 0.245 WHERE "wbCommission" = 0.15;
UPDATE "WbProductCost" SET "logisticsCost" = 87.5 WHERE "logisticsCost" = 80;
UPDATE "WbProductCost" SET "taxRate" = 0.07 WHERE "taxRate" = 0.06;

-- WbSettings singleton
CREATE TABLE IF NOT EXISTS "WbSettings" (
    "id"        INTEGER          NOT NULL DEFAULT 1,
    "kursRb"    DOUBLE PRECISION NOT NULL DEFAULT 4,
    "kursUsd"   DOUBLE PRECISION NOT NULL DEFAULT 75,
    "fixedCost" DOUBLE PRECISION NOT NULL DEFAULT 87.5,
    CONSTRAINT "WbSettings_pkey" PRIMARY KEY ("id")
);
INSERT INTO "WbSettings" ("id", "kursRb", "kursUsd", "fixedCost")
VALUES (1, 4, 75, 87.5)
ON CONFLICT ("id") DO NOTHING;
