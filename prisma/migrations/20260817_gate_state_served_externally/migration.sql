-- A DBS order can be settled without this system ever minting a gate code:
-- orders fulfilled before the gate existed, or handed over by other means.
-- Without a state for that, they stay flagged as an unserved buyer forever.
--
-- Additive only; no existing row changes.
ALTER TYPE "WbMarketplaceGateState" ADD VALUE IF NOT EXISTS 'SERVED_EXTERNALLY';
