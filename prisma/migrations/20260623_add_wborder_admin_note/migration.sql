-- Admin-only free-text note per order (current status / problem the manager is
-- tracking). Shown in the TWA order card, never surfaced to the customer.
-- Nullable & additive — safe to apply before any code reads it.
ALTER TABLE "WbOrder"
  ADD COLUMN IF NOT EXISTS "adminNote" TEXT;
