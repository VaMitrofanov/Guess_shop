-- Drain target account fields on GlobalSettings (leftover donor balance → my account)
ALTER TABLE "GlobalSettings" ADD COLUMN "drainCookie"          TEXT;
ALTER TABLE "GlobalSettings" ADD COLUMN "drainCookieUpdatedAt" TIMESTAMP(3);
ALTER TABLE "GlobalSettings" ADD COLUMN "drainAccountName"     TEXT;
ALTER TABLE "GlobalSettings" ADD COLUMN "drainGamepassId"      TEXT;
ALTER TABLE "GlobalSettings" ADD COLUMN "drainProductId"       INTEGER;

-- CreateTable: durable record of "Выкупить всё" bulk-buyout batches
CREATE TABLE "PurchaseBatch" (
    "id"          TEXT NOT NULL,
    "accountName" TEXT,
    "startedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt"  TIMESTAMP(3),
    "totalGross"  INTEGER NOT NULL DEFAULT 0,
    "okCount"     INTEGER NOT NULL DEFAULT 0,
    "failCount"   INTEGER NOT NULL DEFAULT 0,
    "items"       JSONB NOT NULL,

    CONSTRAINT "PurchaseBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseBatch_startedAt_idx" ON "PurchaseBatch"("startedAt" DESC);
