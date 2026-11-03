ALTER TABLE "User"
    ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
    ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "EmailActionPurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

CREATE TABLE "EmailActionToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "EmailActionPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailActionToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsentEvidence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ipHash" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailActionToken_tokenHash_key" ON "EmailActionToken"("tokenHash");
CREATE INDEX "EmailActionToken_userId_purpose_createdAt_idx" ON "EmailActionToken"("userId", "purpose", "createdAt" DESC);
CREATE INDEX "EmailActionToken_expiresAt_idx" ON "EmailActionToken"("expiresAt");
CREATE INDEX "ConsentEvidence_userId_acceptedAt_idx" ON "ConsentEvidence"("userId", "acceptedAt" DESC);
CREATE INDEX "ConsentEvidence_type_documentVersion_idx" ON "ConsentEvidence"("type", "documentVersion");

ALTER TABLE "EmailActionToken"
    ADD CONSTRAINT "EmailActionToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsentEvidence"
    ADD CONSTRAINT "ConsentEvidence_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
