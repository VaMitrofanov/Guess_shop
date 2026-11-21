-- Ф6.3 (PLAN-twa-bot-ux, Шаг 6): таймер разблокировки робуксов.
-- completedAt — момент фактического выкупа (перехода в COMPLETED), базис
-- «Roblox разблокирует робуксы ~ completedAt + 5 дней». Старые заказы остаются
-- NULL — крон разблокировки их не трогает (нет спама задним числом).
-- robuxUnlockRemindLevel — уровень отправленного пуша (0=нет, 1=день 5, 2=день 7).

ALTER TABLE "WbOrder" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "WbOrder" ADD COLUMN "robuxUnlockRemindLevel" INTEGER NOT NULL DEFAULT 0;
