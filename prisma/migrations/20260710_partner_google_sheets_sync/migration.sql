CREATE TABLE "PartnerImportRun" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "source" "PartnerExternalSource" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "spreadsheetId" TEXT,
    "sheetCount" INTEGER NOT NULL DEFAULT 0,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "diagnostics" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdBy" TEXT,

    CONSTRAINT "PartnerImportRun_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PartnerImportRun" ADD CONSTRAINT "PartnerImportRun_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "PartnerImportRun_partnerId_startedAt_idx" ON "PartnerImportRun"("partnerId", "startedAt" DESC);
CREATE INDEX "PartnerImportRun_partnerId_source_status_idx" ON "PartnerImportRun"("partnerId", "source", "status");
