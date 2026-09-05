DO $$ BEGIN
  CREATE TYPE "RobloxAccountSource" AS ENUM ('ORDER_HISTORY', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "UserRobloxAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "robloxUserId" TEXT,
  "username" TEXT NOT NULL,
  "usernameNormalized" TEXT NOT NULL,
  "displayName" TEXT,
  "avatarUrl" TEXT,
  "description" TEXT,
  "accountCreatedAt" TIMESTAMP(3),
  "profileSyncedAt" TIMESTAMP(3),
  "source" "RobloxAccountSource" NOT NULL,
  "orderCount" INTEGER NOT NULL DEFAULT 0,
  "firstOrderAt" TIMESTAMP(3),
  "lastOrderAt" TIMESTAMP(3),
  "selectedAt" TIMESTAMP(3),
  "hiddenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserRobloxAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserRobloxAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserRobloxAccount_userId_usernameNormalized_key"
  ON "UserRobloxAccount"("userId", "usernameNormalized");
CREATE INDEX IF NOT EXISTS "UserRobloxAccount_userId_hiddenAt_selectedAt_idx"
  ON "UserRobloxAccount"("userId", "hiddenAt", "selectedAt" DESC);
CREATE INDEX IF NOT EXISTS "UserRobloxAccount_userId_robloxUserId_idx"
  ON "UserRobloxAccount"("userId", "robloxUserId");

-- Preserve a profile the customer explicitly linked before the one-to-many
-- model existed. It stays MANUAL unless the same username is proven by a paid
-- or completed order in the second insert below.
INSERT INTO "UserRobloxAccount" (
  "id", "userId", "robloxUserId", "username", "usernameNormalized",
  "displayName", "avatarUrl", "description", "accountCreatedAt",
  "profileSyncedAt", "source", "selectedAt", "createdAt", "updatedAt"
)
SELECT
  'rba_' || md5(u.id || ':' || lower(trim(u."robloxUsername"))),
  u.id,
  u."robloxUserId",
  trim(u."robloxUsername"),
  lower(trim(u."robloxUsername")),
  u."robloxDisplayName",
  u."robloxAvatarUrl",
  u."robloxDescription",
  u."robloxAccountCreatedAt",
  u."robloxProfileSyncedAt",
  'MANUAL',
  u."updatedAt",
  u."createdAt",
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."robloxUsername" IS NOT NULL
  AND trim(u."robloxUsername") <> ''
  AND u."robloxUserId" IS NOT NULL
  AND u."robloxProfileSyncedAt" IS NOT NULL
ON CONFLICT ("userId", "usernameNormalized") DO NOTHING;

-- Only a customer's own non-test paid/completed WbOrder is authoritative for
-- the repeat-buyer selector. probableNick, unpaid intents and merely created
-- checkout orders are deliberately excluded.
WITH eligible AS (
  SELECT
    o."userId",
    lower(trim(o."robloxUsername")) AS normalized,
    (array_agg(trim(o."robloxUsername") ORDER BY o."createdAt" DESC))[1] AS username,
    COUNT(*)::INTEGER AS order_count,
    MIN(o."createdAt") AS first_order_at,
    MAX(o."createdAt") AS last_order_at
  FROM "WbOrder" o
  WHERE o."robloxUsername" IS NOT NULL
    AND trim(o."robloxUsername") <> ''
    AND o."isTest" = FALSE
    AND (o."paidAt" IS NOT NULL OR o.status = 'COMPLETED')
  GROUP BY o."userId", lower(trim(o."robloxUsername"))
)
INSERT INTO "UserRobloxAccount" (
  "id", "userId", "username", "usernameNormalized", "source",
  "orderCount", "firstOrderAt", "lastOrderAt", "selectedAt",
  "createdAt", "updatedAt"
)
SELECT
  'rba_' || md5(e."userId" || ':' || e.normalized),
  e."userId",
  e.username,
  e.normalized,
  'ORDER_HISTORY',
  e.order_count,
  e.first_order_at,
  e.last_order_at,
  e.last_order_at,
  e.first_order_at,
  CURRENT_TIMESTAMP
FROM eligible e
ON CONFLICT ("userId", "usernameNormalized") DO UPDATE SET
  "username" = EXCLUDED."username",
  "source" = 'ORDER_HISTORY',
  "orderCount" = EXCLUDED."orderCount",
  "firstOrderAt" = EXCLUDED."firstOrderAt",
  "lastOrderAt" = EXCLUDED."lastOrderAt",
  "selectedAt" = GREATEST("UserRobloxAccount"."selectedAt", EXCLUDED."lastOrderAt"),
  "updatedAt" = CURRENT_TIMESTAMP;
