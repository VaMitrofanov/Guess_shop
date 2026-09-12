-- Заявка покупателя на возврат (returns-api WB).
--
-- Статусы DBS про возврат не знают вообще: XKFFJUU (WB 5722328333) числился
-- `receive/sold`, покупатель уже открыл заявку, а бот двое суток слал
-- «ваши 500 R$ ждут получения». Аддитивно и nullable: код, который эти поля
-- читает, приезжает следующей волной.
ALTER TABLE "WbMarketplaceOrder" ADD COLUMN IF NOT EXISTS "claimOpenedAt" TIMESTAMP(3);
ALTER TABLE "WbMarketplaceOrder" ADD COLUMN IF NOT EXISTS "claimReason" TEXT;
