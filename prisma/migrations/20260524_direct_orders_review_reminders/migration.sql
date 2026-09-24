-- Add AWAITING_PAYMENT and PAYMENT_PENDING to WbOrderStatus enum
ALTER TYPE "WbOrderStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT';
ALTER TYPE "WbOrderStatus" ADD VALUE IF NOT EXISTS 'PAYMENT_PENDING';

-- Add direct order fields to WbOrder
ALTER TABLE "WbOrder"
  ADD COLUMN IF NOT EXISTS "isDirectOrder"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "paymentDetails" TEXT;

-- Add review bonus reminder fields to User
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "reviewBonusGrantedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewReminderLevel"  INTEGER NOT NULL DEFAULT 0;
