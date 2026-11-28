-- Website Step-7 nick search → one-tap handoff to the bot.
-- selectedGamepassId: the gamepass the user picked on the site search widget.
-- robloxNick: the nick they searched with (also seeds WbOrder.robloxUsername).
-- Both nullable & additive — safe to apply before any code reads them.
ALTER TABLE "WbCode"
  ADD COLUMN IF NOT EXISTS "selectedGamepassId" TEXT,
  ADD COLUMN IF NOT EXISTS "robloxNick" TEXT;
