-- 🎟 Коды активации на сайте + программа приглашений (14.11.2026).
-- Только новые таблицы, типы и nullable-колонки User; существующие строки не меняются.

-- CreateEnum
CREATE TYPE "CodeOrderStatus" AS ENUM ('AWAITING_PAYMENT', 'PAYMENT_PENDING', 'PAID', 'ISSUED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CodeDeliveryMode" AS ENUM ('EMAIL', 'ACCOUNT');

-- CreateEnum
CREATE TYPE "ActivationCodeStatus" AS ENUM ('IN_STOCK', 'RESERVED', 'ISSUED', 'VOID');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referralCode" TEXT,
ADD COLUMN     "referredAt" TIMESTAMP(3),
ADD COLUMN     "referredById" TEXT;

-- CreateTable
CREATE TABLE "CodeOrder" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "denomination" INTEGER NOT NULL,
    "pricingVersion" TEXT NOT NULL,
    "baseAmountKopecks" INTEGER NOT NULL,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "discountKopecks" INTEGER NOT NULL DEFAULT 0,
    "finalAmountKopecks" INTEGER NOT NULL,
    "creatorUserId" TEXT,
    "deliveryMode" "CodeDeliveryMode" NOT NULL,
    "recipientEmail" TEXT,
    "payTokenHash" TEXT NOT NULL,
    "status" "CodeOrderStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "createdVia" TEXT NOT NULL,
    "offerExpiresAt" TIMESTAMP(3) NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3),
    "termsVersion" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "activationCodeId" TEXT,
    "paidAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "revealedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),
    "emailAttempts" INTEGER NOT NULL DEFAULT 0,
    "emailLastError" TEXT,
    "attentionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodePayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'TBANK',
    "providerOrderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "amountKopecks" INTEGER NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "idempotencyKey" TEXT NOT NULL,
    "paymentUrl" TEXT,
    "receiptEmail" TEXT NOT NULL,
    "rawEventHash" TEXT,
    "refundedAmountKopecks" INTEGER NOT NULL DEFAULT 0,
    "initiatedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivationCode" (
    "id" TEXT NOT NULL,
    "denomination" INTEGER NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "codeHmac" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL DEFAULT 'v1',
    "status" "ActivationCodeStatus" NOT NULL DEFAULT 'IN_STOCK',
    "batchLabel" TEXT,
    "reservedForOrderId" TEXT,
    "reservedUntil" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeOrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodeOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CodeOrder_publicId_key" ON "CodeOrder"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "CodeOrder_payTokenHash_key" ON "CodeOrder"("payTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "CodeOrder_idempotencyKey_key" ON "CodeOrder"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CodeOrder_activationCodeId_key" ON "CodeOrder"("activationCodeId");

-- CreateIndex
CREATE INDEX "CodeOrder_creatorUserId_createdAt_idx" ON "CodeOrder"("creatorUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "CodeOrder_status_createdAt_idx" ON "CodeOrder"("status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CodePayment_providerOrderId_key" ON "CodePayment"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "CodePayment_paymentId_key" ON "CodePayment"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "CodePayment_idempotencyKey_key" ON "CodePayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CodePayment_orderId_createdAt_idx" ON "CodePayment"("orderId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ActivationCode_codeHmac_key" ON "ActivationCode"("codeHmac");

-- CreateIndex
CREATE INDEX "ActivationCode_denomination_status_createdAt_idx" ON "ActivationCode"("denomination", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ActivationCode_reservedForOrderId_idx" ON "ActivationCode"("reservedForOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "CodeOrderEvent_idempotencyKey_key" ON "CodeOrderEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CodeOrderEvent_orderId_createdAt_idx" ON "CodeOrderEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE INDEX "User_referredById_idx" ON "User"("referredById");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeOrder" ADD CONSTRAINT "CodeOrder_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeOrder" ADD CONSTRAINT "CodeOrder_activationCodeId_fkey" FOREIGN KEY ("activationCodeId") REFERENCES "ActivationCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodePayment" ADD CONSTRAINT "CodePayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CodeOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeOrderEvent" ADD CONSTRAINT "CodeOrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CodeOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

