-- Разбиение выкупа на несколько геймпассов.
--
-- Гард выкупа сверяет цену пасса с номиналом ЗАКАЗА (ceil(amount / 0.7)).
-- Пока номинал один, заказ на 3000 R$ нельзя закрыть тремя пассами по 1000:
-- каждый выглядит как «цена не та». Здесь у части свой номинал, и гард
-- сверяется с ним. Сумма частей обязана равняться WbOrder.amount — инвариант
-- проверяется в коде при записи разбиения и повторно перед каждой покупкой.
CREATE TABLE "WbOrderGamepass" (
    "id"           TEXT NOT NULL,
    "orderId"      TEXT NOT NULL,
    "gamepassId"   TEXT NOT NULL,
    "gamepassUrl"  TEXT NOT NULL,
    "amount"       INTEGER NOT NULL,
    "position"     INTEGER NOT NULL,
    "chargedPrice" INTEGER,
    "purchasedAt"  TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WbOrderGamepass_pkey" PRIMARY KEY ("id")
);

-- Один и тот же пасс дважды в заказе — удвоенное списание, а со второго раза
-- ещё и AlreadyOwned от Roblox.
CREATE UNIQUE INDEX "WbOrderGamepass_orderId_gamepassId_key" ON "WbOrderGamepass"("orderId", "gamepassId");
CREATE INDEX "WbOrderGamepass_orderId_position_idx" ON "WbOrderGamepass"("orderId", "position");
CREATE INDEX "WbOrderGamepass_gamepassId_idx" ON "WbOrderGamepass"("gamepassId");

ALTER TABLE "WbOrderGamepass"
  ADD CONSTRAINT "WbOrderGamepass_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "WbOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
