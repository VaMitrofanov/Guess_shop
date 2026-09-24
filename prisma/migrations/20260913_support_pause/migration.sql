-- Пауза живого менеджера во ВКонтакте переживает рестарт бота.
-- Аддитивно: колонка nullable, старый код её не читает.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "supportPausedUntil" TIMESTAMP(3);
