-- Экосистема заказов и профилей (18.11.2026). Только добавления: таблица и две колонки.
CREATE TABLE "CodeOrderContact" (
    "id" TEXT NOT NULL,
    "codeOrderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedBy" TEXT,

    CONSTRAINT "CodeOrderContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CodeOrderContact_codeOrderId_userId_key" ON "CodeOrderContact"("codeOrderId", "userId");
CREATE INDEX "CodeOrderContact_userId_idx" ON "CodeOrderContact"("userId");

ALTER TABLE "CodeOrderContact" ADD CONSTRAINT "CodeOrderContact_codeOrderId_fkey" FOREIGN KEY ("codeOrderId") REFERENCES "CodeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CodeOrderContact" ADD CONSTRAINT "CodeOrderContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Экосистема (18.11.2026): почта для чеков и копии кода (не вход, без подтверждения)
-- и когда последний раз звали из ВК в Telegram (не чаще раза в 14 дней).
ALTER TABLE "User" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "User" ADD COLUMN "tgInviteAt" TIMESTAMP(3);
