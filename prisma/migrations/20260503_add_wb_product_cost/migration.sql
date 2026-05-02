-- CreateTable: cost basis for WB products (unit economics calculator)
CREATE TABLE "WbProductCost" (
    "nmID"          INTEGER   NOT NULL,
    "vendorCode"    TEXT      NOT NULL,
    "costPrice"     INTEGER   NOT NULL,
    "wbCommission"  DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "logisticsCost" INTEGER   NOT NULL DEFAULT 80,
    "taxRate"       DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WbProductCost_pkey" PRIMARY KEY ("nmID")
);
