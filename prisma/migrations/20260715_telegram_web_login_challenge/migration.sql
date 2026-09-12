CREATE TABLE "TelegramWebLoginChallenge" (
    "stateHash" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "targetUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramWebLoginChallenge_pkey" PRIMARY KEY ("stateHash")
);

CREATE INDEX "TelegramWebLoginChallenge_expiresAt_idx"
    ON "TelegramWebLoginChallenge"("expiresAt");

CREATE INDEX "TelegramWebLoginChallenge_targetUserId_createdAt_idx"
    ON "TelegramWebLoginChallenge"("targetUserId", "createdAt" DESC);
