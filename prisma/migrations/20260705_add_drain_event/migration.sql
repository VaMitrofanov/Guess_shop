-- DrainEvent: учёт сливов остатка донора в приёмник (PLAN +5.G.2)
CREATE TABLE "DrainEvent" (
    "id" TEXT NOT NULL,
    "donorName" TEXT,
    "drainName" TEXT,
    "amount" INTEGER NOT NULL,
    "gamepassId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrainEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DrainEvent_createdAt_idx" ON "DrainEvent"("createdAt" DESC);
