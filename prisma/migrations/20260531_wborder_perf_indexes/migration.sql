-- Performance indexes for /api/twa/orders (TWA Orders screen).
--
-- Why each one:
--   (status, createdAt DESC) — main listing inside a chip filter sorts by
--   createdAt desc; without this Postgres seq-scans then sorts.
--
--   (robloxUsername) — used by manager search and by identity-cluster numbering
--   (the cluster OR-clause includes robloxUsername=...).
--
--   (userId, createdAt DESC) — per-user history (BossRobux purchase trail,
--   per-customer analytics).
--
-- CONCURRENTLY is omitted because Prisma migrate runs inside a transaction;
-- the WbOrder table is small enough that a brief ACCESS EXCLUSIVE lock during
-- index build is acceptable. If the table grows beyond a few million rows,
-- switch to a manual CREATE INDEX CONCURRENTLY out of band.

CREATE INDEX IF NOT EXISTS "WbOrder_status_createdAt_idx"
  ON "WbOrder" ("status", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "WbOrder_robloxUsername_idx"
  ON "WbOrder" ("robloxUsername");

CREATE INDEX IF NOT EXISTS "WbOrder_userId_createdAt_idx"
  ON "WbOrder" ("userId", "createdAt" DESC);
