ALTER TABLE "WbOrder"
  ADD COLUMN "benefitsRevision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ServiceHeartbeat" (
  "serviceKey" TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "lastAlertAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceHeartbeat_pkey" PRIMARY KEY ("serviceKey")
);

CREATE INDEX "ServiceHeartbeat_lastSeenAt_idx" ON "ServiceHeartbeat"("lastSeenAt");
