-- Migration: add WbCode table for Wildberries card activation codes
-- Each code is unique, tied to a Robux denomination, and can be used only once.

CREATE TABLE "WbCode" (
  "id"           TEXT          NOT NULL,
  "code"         TEXT          NOT NULL,
  "denomination" INTEGER       NOT NULL,
  "isUsed"       BOOLEAN       NOT NULL DEFAULT false,
  "usedAt"       TIMESTAMP(3),
  "batch"        TEXT,
  "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WbCode_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on the code itself
CREATE UNIQUE INDEX "WbCode_code_key" ON "WbCode"("code");

-- Fast lookup for validation (most frequent query)
CREATE INDEX "WbCode_code_idx"         ON "WbCode"("code");
-- Filter unused codes quickly (e.g. stats dashboard)
CREATE INDEX "WbCode_isUsed_idx"       ON "WbCode"("isUsed");
-- Group by denomination
CREATE INDEX "WbCode_denomination_idx" ON "WbCode"("denomination");
