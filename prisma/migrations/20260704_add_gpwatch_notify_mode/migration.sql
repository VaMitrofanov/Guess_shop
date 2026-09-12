-- GP-watch surfaces (+3.1): who gets told when the watcher finds a gamepass.
-- "admin" | "customer" | "both". Default "both": the customer auto-ping was
-- already live when this shipped (ZL6RR9H), so defaulting to admin-only would
-- silently regress it; managers now get an alert for every match as well.
ALTER TABLE "GlobalSettings" ADD COLUMN "gpWatchNotify" TEXT NOT NULL DEFAULT 'both';
