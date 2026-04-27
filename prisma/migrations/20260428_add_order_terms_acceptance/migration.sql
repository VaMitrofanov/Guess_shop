-- ─────────────────────────────────────────────────────────────────────────
-- Migration: add terms-acceptance audit columns to "Order"
--
-- Purpose: capture the moment a user accepts the public offer (ст. 437–438
-- ГК РФ) and consents to personal-data processing (ФЗ-152). The triple
-- (timestamp, version, IP) is the legal evidence we'd produce in case of
-- a Роспотребнадзор complaint or a chargeback dispute with Tinkoff.
--
-- All three columns are nullable so existing rows remain valid; the
-- application code is responsible for writing all three on every new
-- order (enforced via the validator in /api/orders/create).
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "Order"
  ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "termsVersion"    TEXT,
  ADD COLUMN "termsIpAddress"  TEXT;
