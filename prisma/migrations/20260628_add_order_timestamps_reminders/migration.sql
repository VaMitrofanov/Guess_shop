-- AlterTable
ALTER TABLE "WbOrder" ADD COLUMN "pendingAt" TIMESTAMP(3);
ALTER TABLE "WbOrder" ADD COLUMN "takenAt" TIMESTAMP(3);
ALTER TABLE "WbOrder" ADD COLUMN "remindersSent" INTEGER NOT NULL DEFAULT 0;

-- Backfill: set pendingAt from updatedAt for orders that already passed PENDING
UPDATE "WbOrder" SET "pendingAt" = "updatedAt"
  WHERE status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED') AND "pendingAt" IS NULL;

-- Backfill: set takenAt from updatedAt for orders that already passed IN_PROGRESS
UPDATE "WbOrder" SET "takenAt" = "updatedAt"
  WHERE status IN ('IN_PROGRESS', 'COMPLETED') AND "takenAt" IS NULL;
