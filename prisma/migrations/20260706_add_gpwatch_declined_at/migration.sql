-- П3 (PLAN «+7»): клиент ответил «❌ Не мой ник» на GP-watch-пинг.
-- Поле надёжнее парсинга adminNote [НИК-ОТКАЗ]; бейдж в TWA показывает,
-- кого дожимать вручную. Сбрасывается при появлении нового probableNick.
ALTER TABLE "WbOrder" ADD COLUMN "gpWatchDeclinedAt" TIMESTAMP(3);
