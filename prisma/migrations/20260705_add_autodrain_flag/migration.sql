-- Автослив остатка донора (PLAN +5.G.3), kill-switch default OFF
ALTER TABLE "GlobalSettings" ADD COLUMN "autoDrainEnabled" BOOLEAN NOT NULL DEFAULT false;
