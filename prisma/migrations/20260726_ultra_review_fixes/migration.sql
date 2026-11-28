-- Ultra-review 2026-07-25 — фиксы U3, U9, U18.

-- U18: числовой ID геймпасса как отдельное индексируемое поле.
-- Раньше поиск заказа шёл через `gamepassUrl LIKE '%/<id>%'` списком OR —
-- индекс неприменим, полное сканирование на каждом поиске и перед покупкой.
ALTER TABLE "WbOrder" ADD COLUMN "gamepassId" TEXT;

-- U3: фактически применённые бонус и скидка + отметка проведённой компенсации.
-- Скидка обнулялась «в никуда», восстановить её при неудачной оплате было нечем.
ALTER TABLE "WbOrder" ADD COLUMN "bonusAppliedRobux" INTEGER;
ALTER TABLE "WbOrder" ADD COLUMN "discountAppliedKopecks" INTEGER;
ALTER TABLE "WbOrder" ADD COLUMN "benefitsRevertedAt" TIMESTAMP(3);

-- U9: IP согласия с офертой — слабое доказательство; фиксируем и клиента.
ALTER TABLE "WbOrder" ADD COLUMN "termsUserAgent" TEXT;
ALTER TABLE "ConsentEvidence" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "ConsentEvidence" ADD COLUMN "deploymentId" TEXT;

-- Backfill U18: вытаскиваем ID из существующих ссылок вида
-- https://www.roblox.com/game-pass/1234567890/Name и /game-passes/1234567890.
UPDATE "WbOrder"
SET "gamepassId" = (regexp_match("gamepassUrl", 'game-pass(?:es)?/(\d+)'))[1]
WHERE "gamepassUrl" IS NOT NULL
  AND "gamepassUrl" ~ 'game-pass(?:es)?/\d+';

CREATE INDEX "WbOrder_gamepassId_idx" ON "WbOrder"("gamepassId");

-- U18: держим `gamepassId` в синхроне с `gamepassUrl` на уровне БД. Ссылку на
-- геймпасс пишут больше десяти мест (сайт, оба бота, TWA, ручное создание,
-- замена пасса), и любое забытое место означало бы заказ, невидимый для
-- индексного поиска. Триггер снимает этот класс ошибок целиком.
CREATE OR REPLACE FUNCTION "wborder_sync_gamepass_id"() RETURNS trigger AS $$
BEGIN
  NEW."gamepassId" := (regexp_match(COALESCE(NEW."gamepassUrl", ''), 'game-pass(?:es)?/(\d+)'))[1];
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "wborder_gamepass_id_sync" ON "WbOrder";
CREATE TRIGGER "wborder_gamepass_id_sync"
BEFORE INSERT OR UPDATE OF "gamepassUrl" ON "WbOrder"
FOR EACH ROW EXECUTE FUNCTION "wborder_sync_gamepass_id"();
