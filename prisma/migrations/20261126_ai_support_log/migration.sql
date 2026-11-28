-- 🤖 Журнал ИИ-поддержки (26.11.2026). Аддитивно: новая таблица, старое не трогаем.
CREATE TABLE "AiSupportLog" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "peerKey" TEXT NOT NULL,
    "orderCode" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSupportLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiSupportLog_createdAt_idx" ON "AiSupportLog"("createdAt");
CREATE INDEX "AiSupportLog_channel_createdAt_idx" ON "AiSupportLog"("channel", "createdAt");
