-- Add updatedAt audit timestamp to WbCode.
-- Uses COALESCE(createdAt, NOW()) as default for existing rows so they get
-- a meaningful value instead of the epoch.
ALTER TABLE "WbCode"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();
