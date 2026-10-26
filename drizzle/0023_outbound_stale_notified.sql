-- Mirrai: saying it once
--
-- A letter that has been waiting for a month is not going to be sent by
-- accident, and saying so once is useful. Saying it every time the page
-- is opened is nagging — and nagging is the one thing this product
-- promises not to do.
--
-- So the reminder is recorded next to the letter, and it is said once.
--
-- mirrai: idempotent-migration

ALTER TABLE "outbound_letters" ADD COLUMN IF NOT EXISTS "staleNotifiedAt" timestamp;

-- mirrai: down
--
-- The way back. A migration that cannot be undone cannot be rolled
-- back, so every migration in this phase carries its own.
--

ALTER TABLE "outbound_letters" DROP COLUMN IF EXISTS "staleNotifiedAt";
