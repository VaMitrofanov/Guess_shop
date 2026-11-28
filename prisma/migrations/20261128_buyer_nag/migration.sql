-- Очередь «Ебут мозги» (28.11.2026): тон покупателя от ИИ и ручное «Опустить».
ALTER TABLE "AiSupportLog" ADD COLUMN "tone" TEXT;
CREATE INDEX "AiSupportLog_orderCode_createdAt_idx" ON "AiSupportLog"("orderCode", "createdAt");
ALTER TABLE "WbOrder" ADD COLUMN "nagDismissedAt" TIMESTAMP(3);
