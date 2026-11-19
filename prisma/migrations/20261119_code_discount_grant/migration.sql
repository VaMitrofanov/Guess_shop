-- 🎁 Подарочная скидка на коды (19.11.2026). Аддитивно: новая таблица, старое не трогаем.
CREATE TABLE "CodeDiscountGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "grantedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "usedOrderId" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CodeDiscountGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CodeDiscountGrant_usedOrderId_key" ON "CodeDiscountGrant"("usedOrderId");
CREATE INDEX "CodeDiscountGrant_userId_usedAt_idx" ON "CodeDiscountGrant"("userId", "usedAt");

ALTER TABLE "CodeDiscountGrant" ADD CONSTRAINT "CodeDiscountGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
