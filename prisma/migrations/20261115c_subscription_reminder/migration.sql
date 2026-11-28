-- Скидка 1 % = регистрация + подписка; напоминание о неоплаченном коде (15.11.2026). Только ADD.
ALTER TABLE "User"
  ADD COLUMN "channelSubscribed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "channelCheckedAt" TIMESTAMP(3);
ALTER TABLE "CodeOrder" ADD COLUMN "payReminderSentAt" TIMESTAMP(3);
