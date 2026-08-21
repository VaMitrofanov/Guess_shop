UPDATE "PricingPolicy"
SET
  "isActive" = false,
  "validUntil" = COALESCE("validUntil", CURRENT_TIMESTAMP),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "version" = 'retail-direct-v1';

INSERT INTO "PricingPolicy" (
  "id", "version", "definition", "isActive", "validFrom", "createdAt", "updatedAt"
)
VALUES (
  'retail-direct-v2',
  'retail-direct-v2',
  '{"currency":"RUB","customMin":100,"customMax":100000,"targetNetCurve":[{"amountRobux":1,"rubPerRobux":3},{"amountRobux":10,"rubPerRobux":2},{"amountRobux":50,"rubPerRobux":1.6},{"amountRobux":100,"rubPerRobux":1.3},{"amountRobux":500,"rubPerRobux":1},{"amountRobux":1000,"rubPerRobux":0.9},{"amountRobux":3000,"rubPerRobux":0.8},{"amountRobux":5000,"rubPerRobux":0.7}],"deductions":{"usnIncomePct":6,"acquiringPct":3.49,"acquiringMinRub":3.49,"dolyamiIncluded":false,"separateReceiptFeeIncluded":false},"rounding":"whole-ruble-up"}'::jsonb,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("version") DO UPDATE SET
  "definition" = EXCLUDED."definition",
  "isActive" = true,
  "validUntil" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP;
