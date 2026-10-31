-- Auto-buyout worker (+1): buy new PENDING orders automatically until the donor
-- balance reaches the drain threshold. All columns default OFF/safe.
ALTER TABLE "GlobalSettings" ADD COLUMN "autoBuyoutEnabled"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GlobalSettings" ADD COLUMN "autoBuyoutThreshold"  INTEGER NOT NULL DEFAULT 150;
ALTER TABLE "GlobalSettings" ADD COLUMN "autoBuyoutMaxPerTick" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "GlobalSettings" ADD COLUMN "autoBuyoutBelowSince" TIMESTAMP(3);

-- GP-watcher (+3): follow a probable nick until its gamepass appears, then ask
-- the customer to confirm. Kill-switch defaults OFF.
ALTER TABLE "GlobalSettings" ADD COLUMN "gpWatchEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Probable nick captured "in pencil" (mirrors the [НИК?] adminNote history, but
-- structured so the watcher does not have to parse free text). Last one wins.
ALTER TABLE "WbOrder" ADD COLUMN "probableNick"          TEXT;
ALTER TABLE "WbOrder" ADD COLUMN "probableNickAt"        TIMESTAMP(3);
ALTER TABLE "WbOrder" ADD COLUMN "gpWatchLastCheckAt"    TIMESTAMP(3);
ALTER TABLE "WbOrder" ADD COLUMN "gpWatchNotifiedPassId" TEXT;

-- Watcher selection: AWAITING_GAMEPASS orders that have a probable nick.
CREATE INDEX "WbOrder_status_probableNick_idx" ON "WbOrder"("status", "probableNick");

-- Backfill probableNick from the existing [НИК? …] adminNote history (written by
-- the early-capture helper and scripts/backfill-probable-nicks.mjs before this
-- column existed). Greedy `.*` grabs the LAST such line's nick (last one wins).
UPDATE "WbOrder"
SET "probableNick"   = (regexp_match("adminNote", '.*\[НИК\? [0-9-]+\] ([A-Za-z0-9_]+)'))[1],
    "probableNickAt" = "updatedAt"
WHERE "probableNick" IS NULL
  AND "adminNote" ~ '\[НИК\? ';
