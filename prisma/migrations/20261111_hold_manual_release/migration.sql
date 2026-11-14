-- 🛡 Разморозка админом сильнее автоматики (11.11.2026).
-- Только новые nullable-колонки + заполнение по истории уже снятых заморозок.
ALTER TABLE "OrderHold" ADD COLUMN "manualReleaseAt" TIMESTAMP(3);
ALTER TABLE "OrderHold" ADD COLUMN "manualReleaseBy" TEXT;
ALTER TABLE "WbOrder" ADD COLUMN "manualReleaseAt" TIMESTAMP(3);
ALTER TABLE "WbOrder" ADD COLUMN "manualReleaseBy" TEXT;

-- Снятые человеком (не автоматикой) и до сих пор не замороженные снова.
UPDATE "OrderHold"
   SET "manualReleaseAt" = "releasedAt", "manualReleaseBy" = "releasedBy"
 WHERE "releasedAt" IS NOT NULL
   AND "releasedBy" IS NOT NULL
   AND "releasedBy" NOT LIKE 'автозащита%'
   AND "releasedBy" NOT LIKE 'гейт выкупа%'
   AND "releasedBy" NOT LIKE 'wb-sync%';

UPDATE "WbOrder" o
   SET "manualReleaseAt" = h."manualReleaseAt", "manualReleaseBy" = h."manualReleaseBy"
  FROM "OrderHold" h
 WHERE h."wbCode" = o."wbCode" AND h."manualReleaseAt" IS NOT NULL;
