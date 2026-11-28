-- Витрина 2.0 (15.11.2026): подарки открыткой, канал заказа (сайт/TG/VK),
-- оценка после оплаты, лента отзывов WB. Только ADD/CREATE — аддитивно.

ALTER TYPE "CodeDeliveryMode" ADD VALUE IF NOT EXISTS 'GIFT';

ALTER TABLE "CodeOrder"
  ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'SITE',
  ADD COLUMN "chatDeliveredAt" TIMESTAMP(3),
  ADD COLUMN "giftTheme" TEXT,
  ADD COLUMN "giftTo" TEXT,
  ADD COLUMN "giftFrom" TEXT,
  ADD COLUMN "giftMessage" TEXT,
  ADD COLUMN "giftSendAt" TIMESTAMP(3),
  ADD COLUMN "giftSentAt" TIMESTAMP(3),
  ADD COLUMN "giftOpenTokenHash" TEXT,
  ADD COLUMN "giftOpenedAt" TIMESTAMP(3),
  ADD COLUMN "rating" INTEGER,
  ADD COLUMN "ratedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "CodeOrder_giftOpenTokenHash_key" ON "CodeOrder"("giftOpenTokenHash");
CREATE INDEX "CodeOrder_status_issuedAt_idx" ON "CodeOrder"("status", "issuedAt");

CREATE TABLE "WbReview" (
    "id" TEXT NOT NULL,
    "nmId" INTEGER,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "wbCreatedAt" TIMESTAMP(3) NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WbReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WbReview_eligible_hidden_wbCreatedAt_idx" ON "WbReview"("eligible", "hidden", "wbCreatedAt" DESC);
