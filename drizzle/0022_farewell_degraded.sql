-- Mirrai: telling the truth about the farewell
--
-- The letter is written in two passes now. When the second one cannot
-- finish in time, the older single-pass letter is used — the same letter
-- as before, but plainer. The user is told which one they are reading.
--
-- mirrai: idempotent-migration

ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "farewellDegraded" boolean NOT NULL DEFAULT false;

-- mirrai: down
--
-- The way back. A migration that cannot be undone cannot be rolled
-- back, so every migration in this phase carries its own.
--

ALTER TABLE "personas" DROP COLUMN IF EXISTS "farewellDegraded";
