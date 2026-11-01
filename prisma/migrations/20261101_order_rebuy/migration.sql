-- 🔁 Перевыкуп (01.11.2026): метка «выкуплен, но не дошёл — выкупить снова».
-- Только новые nullable-колонки, существующие строки не меняются.
ALTER TABLE "WbOrder" ADD COLUMN "rebuyAt" TIMESTAMP(3);
ALTER TABLE "WbOrder" ADD COLUMN "rebuyReason" TEXT;
ALTER TABLE "WbOrder" ADD COLUMN "rebuyBy" TEXT;
