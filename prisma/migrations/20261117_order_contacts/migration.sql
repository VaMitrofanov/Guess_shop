-- Дополнительные аккаунты заказа (17.11.2026). Только добавление таблицы.
CREATE TABLE "OrderContact" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "evidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedBy" TEXT,

    CONSTRAINT "OrderContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderContact_orderId_userId_key" ON "OrderContact"("orderId", "userId");
CREATE INDEX "OrderContact_userId_idx" ON "OrderContact"("userId");

ALTER TABLE "OrderContact" ADD CONSTRAINT "OrderContact_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "WbOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderContact" ADD CONSTRAINT "OrderContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
