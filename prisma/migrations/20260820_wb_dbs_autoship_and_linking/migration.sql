-- DBS: автозакрытие доставки, напоминания о неоткрытом гейте, живая карточка
-- в админке и привязка покупателя по коду доставки.
-- Разбор: docs/wb-dbs-review-2026-08-20.md
--
-- Всё аддитивно: колонки nullable либо с дефолтом, существующие строки не
-- переписываются, индекс создаётся по уже существующей колонке.

-- Э7: расписание напоминаний считается от момента, когда гейт реально ушёл
-- покупателю. Раньше это пришлось бы выводить из аудита — скан всех событий
-- на каждый открытый заказ в каждом цикле.
ALTER TABLE "WbMarketplaceOrder" ADD COLUMN IF NOT EXISTS "gateSentAt" TIMESTAMP(3);
ALTER TABLE "WbMarketplaceOrder" ADD COLUMN IF NOT EXISTS "gateReminderLevel" INTEGER NOT NULL DEFAULT 0;

-- Э1: «окно WB истекает» — это разовый крик по заказу, а не сообщение раз в
-- цикл. Метка времени служит дедупликацией.
ALTER TABLE "WbMarketplaceOrder" ADD COLUMN IF NOT EXISTS "deliveryAlertedAt" TIMESTAMP(3);

-- Э5-B: { "<adminTgId>": <messageId> } — одна живая карточка на заказ у каждого
-- админа. Редактирование этого сообщения заменяет прежние 4–5 отдельных.
ALTER TABLE "WbMarketplaceOrder" ADD COLUMN IF NOT EXISTS "adminCardMessages" JSONB;

-- Э2: покупатель, приславший в бота код доставки WB вместо нашего кода, должен
-- узнаваться точным совпадением по keyed-hash, а не получать «нет активных
-- заявок». Лимиты и трёхчасовое окно — в §7 (О5) документа.
CREATE INDEX IF NOT EXISTS "WbDeliverySecret_codeHmac_idx" ON "WbDeliverySecret"("codeHmac");

-- Э7: заказы, у которых гейт уже ушёл до этой миграции, не должны получить
-- напоминание задним числом — им проставляется момент последней синхронизации.
UPDATE "WbMarketplaceOrder"
   SET "gateSentAt" = COALESCE("completedAt", "lastSeenAt"),
       "gateReminderLevel" = 2
 WHERE "gateState" IN ('SENT', 'SERVED_EXTERNALLY')
   AND "gateSentAt" IS NULL;
