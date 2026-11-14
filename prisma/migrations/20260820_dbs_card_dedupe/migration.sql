-- One live admin card per DBS order, and only pushed when it actually changed.
--
-- The card already existed but never learned its own message id (the SG bridge
-- dropped `message_id` from every send), so each refresh sent a new message:
-- order 5536525331 produced three identical cards in one second on 20.08.
-- Storing the rendered text's hash makes a no-op refresh cost nothing even if
-- the id is ever lost again.
ALTER TABLE "WbMarketplaceOrder" ADD COLUMN "adminCardHash" TEXT;
