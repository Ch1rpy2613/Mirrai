-- Mirrai: what the second pass kept, and what it cut
--
-- The farewell is written in two passes: five sentences the person
-- never said, then a subtraction that leaves only what a last word
-- needs. Which lines survived, and which were cut, is worth keeping —
-- it is the part of the writing the reader might want to see.
--
-- mirrai: idempotent-migration

ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "farewellDraft" jsonb;

-- mirrai: down
--
-- The way back. A migration that cannot be undone cannot be rolled
-- back, so every migration in this phase carries its own.
--

ALTER TABLE "personas" DROP COLUMN IF EXISTS "farewellDraft";
