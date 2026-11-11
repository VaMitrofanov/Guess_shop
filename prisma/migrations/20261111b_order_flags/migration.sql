-- 🏷 Пометки заказа (11.11.2026): видны, но выкуп не блокируют.
-- Только новые nullable-колонки и индекс; существующие строки не меняются.
ALTER TABLE "WbOrder" ADD COLUMN "flags" JSONB;
ALTER TABLE "WbOrder" ADD COLUMN "flaggedAt" TIMESTAMP(3);
CREATE INDEX "WbOrder_flaggedAt_idx" ON "WbOrder"("flaggedAt");
