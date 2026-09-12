-- Аннулирование кода гейта после возврата денег на WB.
--
-- Отмена заказа на Wildberries возвращает покупателю деньги, но код гейта
-- оставался рабочим: ни одна из девяти точек активации не смотрела на
-- `cancelledAt` (XKFFJUU, WB #5722328333, 12.09.2026 — деньги вернулись,
-- код остался AVAILABLE). `REVOKED` закрывает дверь на входе; вторая защёлка —
-- заморозка по коду, её ставит то же ядро (bots/shared/wb-code-revocation.ts).
--
-- ADD VALUE IF NOT EXISTS безопасен внутри транзакции с PG 12; здесь PG 17 и
-- значение в этой же миграции не используется.
ALTER TYPE "WbCodeStatus" ADD VALUE IF NOT EXISTS 'REVOKED';

-- Решение по заявке на возврат (returns-api WB: 1 — на рассмотрении,
-- 2 — решение принято, детали в status_ex).
--
-- Про открытие заявки мы узнали в прошлой волне, а про её ИСХОД — по-прежнему
-- ниоткуда: статус DBS-заказа меняется только в момент возврата денег, и между
-- заявкой и отменой проходило от полутора суток (XKFFJUU) до восьми (BJUM4MN).
ALTER TABLE "WbMarketplaceOrder" ADD COLUMN IF NOT EXISTS "claimStatus" INTEGER;
ALTER TABLE "WbMarketplaceOrder" ADD COLUMN IF NOT EXISTS "claimResolvedAt" TIMESTAMP(3);
