ALTER TABLE "WbOrder"
  ADD COLUMN "saleAmountKopecks" INTEGER,
  ADD COLUMN "purchaseRobuxAmount" INTEGER,
  ADD COLUMN "purchaseRateUsdPer1k" DOUBLE PRECISION,
  ADD COLUMN "purchaseUsdToRub" DOUBLE PRECISION,
  ADD COLUMN "purchaseCostKopecks" INTEGER,
  ADD COLUMN "profitKopecks" INTEGER;

ALTER TABLE "WbOrder"
  ADD CONSTRAINT "WbOrder_saleAmountKopecks_nonnegative" CHECK ("saleAmountKopecks" IS NULL OR "saleAmountKopecks" >= 0),
  ADD CONSTRAINT "WbOrder_purchaseRobuxAmount_positive" CHECK ("purchaseRobuxAmount" IS NULL OR "purchaseRobuxAmount" > 0),
  ADD CONSTRAINT "WbOrder_purchaseCostKopecks_nonnegative" CHECK ("purchaseCostKopecks" IS NULL OR "purchaseCostKopecks" >= 0);
