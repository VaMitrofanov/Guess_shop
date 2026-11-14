-- Persist the target net-profit margin used by the admin Game Pass calculator.
-- Existing production pricing is not changed by this migration: legacy NULL
-- is derived from the current 1000 R$ pack until the admin saves a value.
ALTER TABLE "GlobalSettings"
ADD COLUMN "gamepassTargetMarginPct" DOUBLE PRECISION;
