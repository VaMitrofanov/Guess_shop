-- Anton partner accounting moved from internal R$ ledger to USDT.
-- The Robux price stays on each task; partner money is debited in USDT by a
-- configurable rate in Partner.robuxRateUsdtPer1000.

ALTER TABLE "Partner"
  ADD COLUMN "ledgerCurrency" TEXT NOT NULL DEFAULT 'USDT',
  ADD COLUMN "robuxRateUsdtPer1000" DOUBLE PRECISION NOT NULL DEFAULT 5.05,
  ADD COLUMN "googleSheetId" TEXT,
  ADD COLUMN "googleSheetTab" TEXT,
  ADD COLUMN "googleSheetUrl" TEXT;

UPDATE "Partner"
SET
  "ledgerCurrency" = 'USDT',
  "robuxRateUsdtPer1000" = 5.05,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'anton';

INSERT INTO "Partner" (
  "id",
  "slug",
  "name",
  "isActive",
  "notes",
  "ledgerCurrency",
  "robuxRateUsdtPer1000",
  "createdAt",
  "updatedAt"
)
SELECT
  'partner_anton',
  'anton',
  'Антон',
  true,
  'First B2B partner. Ledger currency: USDT.',
  'USDT',
  5.05,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "Partner" WHERE "slug" = 'anton'
);

WITH anton AS (
  SELECT "id" FROM "Partner" WHERE "slug" = 'anton'
)
INSERT INTO "PartnerBuyoutTask" (
  "id",
  "partnerId",
  "externalRowId",
  "externalSource",
  "status",
  "robloxUsername",
  "gamepassId",
  "gamepassUrl",
  "priceRobux",
  "purchasePriceRobux",
  "sheetRaw",
  "completedAt",
  "note",
  "createdAt",
  "updatedAt"
)
SELECT
  data.id,
  anton."id",
  data.external_row_id,
  'GOOGLE_SHEETS'::"PartnerExternalSource",
  'DONE'::"PartnerTaskStatus",
  data.roblox_username,
  data.gamepass_id,
  'https://www.roblox.com/game-pass/' || data.gamepass_id,
  data.gamepass_price,
  data.gamepass_price,
  jsonb_build_object(
    'source', 'selected-roblox-orders-2026-07-09 10_31_39 (1).xlsx',
    'row', data.row_no,
    'gamepassId', data.gamepass_id,
    'robuxAmount', data.robux_amount,
    'gamepassPrice', data.gamepass_price,
    'robloxUsername', data.roblox_username,
    'robloxUserId', data.roblox_user_id
  ),
  CURRENT_TIMESTAMP,
  'Импортировано из XLSX 2026-07-09; выкуплено до подключения Google Sheets sync',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM anton
CROSS JOIN (
  VALUES
    ('anton_xlsx_20260709_row2', 'xlsx:2026-07-09:row2', 2, '1748619894', 850, 1215, 'T4hx1x', '8196751598'),
    ('anton_xlsx_20260709_row3', 'xlsx:2026-07-09:row3', 3, '1797124732', 1300, 1858, 'yuiop_ez', '3232155936'),
    ('anton_xlsx_20260709_row4', 'xlsx:2026-07-09:row4', 4, '1293378197', 5000, 7143, 'dyamon_devil', '1562489861'),
    ('anton_xlsx_20260709_row5', 'xlsx:2026-07-09:row5', 5, '681541974', 1000, 1429, 'miwkacawa', '2762029342'),
    ('anton_xlsx_20260709_row6', 'xlsx:2026-07-09:row6', 6, '1862576961', 2500, 3572, 'knit361', '5608423477'),
    ('anton_xlsx_20260709_row7', 'xlsx:2026-07-09:row7', 7, '739813108', 722, 1032, 'vasili_2012', '2291262183'),
    ('anton_xlsx_20260709_row8', 'xlsx:2026-07-09:row8', 8, '1899014665', 799, 1142, 'Matvejchic', '1628867898'),
    ('anton_xlsx_20260709_row9', 'xlsx:2026-07-09:row9', 9, '1900130416', 1200, 1715, 'Mipsiti_1234', '3779156884')
) AS data(id, external_row_id, row_no, gamepass_id, robux_amount, gamepass_price, roblox_username, roblox_user_id)
ON CONFLICT ("partnerId", "externalSource", "externalRowId") DO NOTHING;

WITH anton AS (
  SELECT "id" FROM "Partner" WHERE "slug" = 'anton'
)
INSERT INTO "PartnerLedgerEntry" (
  "id",
  "partnerId",
  "type",
  "amount",
  "currency",
  "reference",
  "comment",
  "createdBy",
  "createdAt"
)
SELECT
  'anton_ledger_20260709_topup_150_usdt',
  anton."id",
  'TOPUP'::"PartnerLedgerType",
  150.00,
  'USDT',
  'anton-usdt-topup-2026-07-09',
  'Оплата Антона: 150 USDT',
  'migration:20260709_partner_anton_usdt_sheets',
  CURRENT_TIMESTAMP
FROM anton
WHERE NOT EXISTS (
  SELECT 1 FROM "PartnerLedgerEntry"
  WHERE "reference" = 'anton-usdt-topup-2026-07-09'
);

WITH anton AS (
  SELECT "id" FROM "Partner" WHERE "slug" = 'anton'
)
INSERT INTO "PartnerLedgerEntry" (
  "id",
  "partnerId",
  "type",
  "amount",
  "currency",
  "reference",
  "comment",
  "createdBy",
  "createdAt"
)
SELECT
  'anton_ledger_20260709_buyout_19106r_usdt',
  anton."id",
  'BUYOUT'::"PartnerLedgerType",
  -96.49,
  'USDT',
  'anton-xlsx-2026-07-09-19106R',
  'Списание за 8 выкупленных геймпассов: 19 106 R$ × 5.05 USDT / 1000 R$ = 96.49 USDT',
  'migration:20260709_partner_anton_usdt_sheets',
  CURRENT_TIMESTAMP
FROM anton
WHERE NOT EXISTS (
  SELECT 1 FROM "PartnerLedgerEntry"
  WHERE "reference" = 'anton-xlsx-2026-07-09-19106R'
);
