-- Mirrai: where a message came from
--
-- The answer to a letter lands in the conversation, but without a
-- marker it was just another message — and the connection to the letter
-- was lost the moment it arrived.
--
-- mirrai: idempotent-migration

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "origin" varchar(16);
