ALTER TABLE "PaymentAttempt"
  ADD COLUMN "refundedAmountKopecks" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "OutboxMessage"
  ADD COLUMN "lockedAt" TIMESTAMP(3);

CREATE TABLE "PaymentRefund" (
  "id" TEXT NOT NULL,
  "paymentAttemptId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "amountKopecks" INTEGER NOT NULL,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "providerStatus" TEXT,
  "responseHash" TEXT,
  "requestedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentRefund_idempotencyKey_key" ON "PaymentRefund"("idempotencyKey");
CREATE INDEX "PaymentRefund_paymentAttemptId_createdAt_idx" ON "PaymentRefund"("paymentAttemptId", "createdAt" DESC);
CREATE INDEX "PaymentRefund_status_updatedAt_idx" ON "PaymentRefund"("status", "updatedAt");
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_paymentAttemptId_fkey"
  FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
