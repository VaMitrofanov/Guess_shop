-- Хранение Open Cloud API-ключей покупателей (инструкция V2, «сделаем за тебя»).
--
-- Зачем хранить, а не стирать после использования (решение владельца 06.09.2026):
--   1. Пасс, созданный по ключу, иногда надо ПОПРАВИТЬ (цена, «в продаже») —
--      без ключа это снова просьба к покупателю зайти в Creator Hub.
--   2. Постоянному покупателю на следующем заказе пасс создаётся сразу: ему
--      останется только оплатить.
-- Права ключа ограничены геймпассами (`game-passes: read + write`): доступа к
-- аккаунту, робуксам и платежам он не даёт, срок жизни у него бессрочный, если
-- покупатель не выбрал дату истечения.
--
-- Значение лежит ЗАШИФРОВАННЫМ (AES-256-GCM, тот же конверт и тот же
-- `WB_DELIVERY_ENCRYPTION_KEY`, что у кодов доставки WB). `keyHmac` —
-- ключ дедупликации: один и тот же ключ, присланный дважды, не плодит строк.
CREATE TABLE IF NOT EXISTS "RobloxApiKey" (
    "id"             TEXT NOT NULL,
    "robloxUsername" TEXT NOT NULL,
    "userId"         TEXT,
    "encryptedValue" TEXT NOT NULL,
    "keyHmac"        TEXT NOT NULL,
    "keyVersion"     TEXT NOT NULL DEFAULT 'v1',
    "lastOrderId"    TEXT,
    "lastResult"     TEXT,
    "lastUsedAt"     TIMESTAMP(3),
    "useCount"       INTEGER NOT NULL DEFAULT 0,
    "createdPasses"  INTEGER NOT NULL DEFAULT 0,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobloxApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RobloxApiKey_keyHmac_key" ON "RobloxApiKey" ("keyHmac");
CREATE INDEX IF NOT EXISTS "RobloxApiKey_robloxUsername_idx" ON "RobloxApiKey" ("robloxUsername");
CREATE INDEX IF NOT EXISTS "RobloxApiKey_userId_idx" ON "RobloxApiKey" ("userId");

-- Ключ переживает удаление пользователя (сам ключ принадлежит аккаунту Roblox,
-- а не нашей учётке), поэтому связь мягкая: ON DELETE SET NULL.
DO $$
BEGIN
  ALTER TABLE "RobloxApiKey"
    ADD CONSTRAINT "RobloxApiKey_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
