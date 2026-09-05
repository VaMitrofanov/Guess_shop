-- Matching a WB chat to a conversation in our bot used to mean comparing order
-- numbers by hand, because the console only ever showed "WB #5508907054".
-- The DBS client endpoint gives the buyer's name, which is what an operator
-- actually recognises.
--
-- Scope is deliberate: the first name only. No phone, no address, no full FIO —
-- a digital handover never needs them, and what we do not store cannot leak.
--
-- Additive only; nullable, no backfill, no existing row changes.
ALTER TABLE "WbMarketplaceOrder" ADD COLUMN IF NOT EXISTS "buyerName" TEXT;
