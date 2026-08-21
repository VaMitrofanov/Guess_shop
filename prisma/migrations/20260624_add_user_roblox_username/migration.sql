-- Persist the Roblox username on the User profile so repeat orders
-- (direct purchases) can skip the nick-entry step.
-- Nullable & additive — safe to apply before any code reads it.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "robloxUsername" TEXT;
