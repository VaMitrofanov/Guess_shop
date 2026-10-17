-- Прямой заказ в ботах закрывается НАБОРОМ пассов, как коридор ВБ (1500 + 500
-- под 2000): набор живёт в заявке до создания заказа, потом ложится в
-- `WbOrderGamepass`. Аддитивно: колонка nullable, старый код её не читает.
ALTER TABLE "DirectIntent" ADD COLUMN IF NOT EXISTS "parts" JSONB;
