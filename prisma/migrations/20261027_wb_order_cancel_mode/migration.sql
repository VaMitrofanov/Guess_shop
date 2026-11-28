-- Режим отмены DBS-заказа: код доставки уходит оператору вместо автозакрытия.
ALTER TABLE "WbMarketplaceOrder" ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);
ALTER TABLE "WbMarketplaceOrder" ADD COLUMN "cancelRequestedBy" TEXT;
