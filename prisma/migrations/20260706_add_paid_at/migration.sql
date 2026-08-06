-- П5 (PLAN «+7»): гейт неоплаченных прямых заказов.
-- paidAt проставляется при подтверждении оплаты (pay_ok в TG-карточке);
-- DIR-заказ без paidAt исключается из всех путей выкупа.
ALTER TABLE "WbOrder" ADD COLUMN "paidAt" TIMESTAMP(3);

-- Бэкфилл: DIR-заказы, уже прошедшие оплату. В штатном флоу статусы
-- PENDING/IN_PROGRESS/COMPLETED достижимы только через pay_ok, поэтому
-- помечаем их оплаченными (updatedAt — ближайшая известная дата).
-- Проблемные неоплаченные заказы живут в AWAITING_PAYMENT/PAYMENT_PENDING
-- и бэкфиллом не затрагиваются.
UPDATE "WbOrder"
SET "paidAt" = "updatedAt"
WHERE "isDirectOrder" = true
  AND status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED');
