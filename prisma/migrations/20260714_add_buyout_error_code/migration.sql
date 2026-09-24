ALTER TABLE "WbOrder"
ADD COLUMN "buyoutErrorCode" TEXT;

CREATE INDEX "WbOrder_status_buyoutErrorCode_idx"
ON "WbOrder"("status", "buyoutErrorCode");
