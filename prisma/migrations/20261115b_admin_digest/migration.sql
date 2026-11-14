-- Часовая сводка «Ленты заказов» (15.11.2026). Только CREATE — аддитивно.
CREATE TABLE "AdminDigestItem" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL DEFAULT 'feed',
    "line" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "AdminDigestItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminDigestItem_sentAt_createdAt_idx" ON "AdminDigestItem"("sentAt", "createdAt");
