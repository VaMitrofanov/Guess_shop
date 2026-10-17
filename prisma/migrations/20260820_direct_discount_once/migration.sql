-- The 60 ₽ discount is granted once per customer, not after every completed
-- direct order under 500 R$ (which is what the code did: five orders by one
-- customer at 84 ₽ instead of 144 ₽, ~300 ₽ short).
ALTER TABLE "User" ADD COLUMN "directDiscountGrantedAt" TIMESTAMP(3);

-- Anyone holding the discount right now was granted it under the old rule.
-- Owner's decision O2 (20.08): those balances stay. Stamping them closes the
-- loop for good — they can spend what they have and never earn another.
UPDATE "User" SET "directDiscountGrantedAt" = NOW() WHERE "rubleDiscount" > 0;
