-- Anton's Google Sheet is the monetary source of truth. Its formula is
-- SUMPRODUCT(C, F) / 1000, where C is the gross gamepass nominal and F is the
-- rate pinned for that order. Roblox's 30% fee remains analytics metadata and
-- must not reduce the partner debit.
INSERT INTO "PartnerRateChange"
  (id, "partnerId", rate, "previousRate", "purchaseRate", "previousPurchaseRate",
   "rateBasis", "previousRateBasis", "robloxFeePct", "createdBy", "createdAt")
SELECT
  'anton_rate_20260730_sheet_gross', p.id,
  p."robuxRateUsdtPer1000", p."robuxRateUsdtPer1000",
  p."purchaseRateUsdtPer1000", p."purchaseRateUsdtPer1000",
  'DIRTY', p."rateBasis", p."robloxFeePct",
  'migration:sheet-formula-20260730', CURRENT_TIMESTAMP
FROM "Partner" p
WHERE p.slug = 'anton' AND p."rateBasis" <> 'DIRTY'
ON CONFLICT (id) DO NOTHING;

UPDATE "Partner"
SET "rateBasis" = 'DIRTY'
WHERE slug = 'anton';
