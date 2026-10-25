-- Mirrai: pinning a persona
--
-- A person with six personas and one they talk to every day should not
-- have to hunt for it every morning.
--
-- mirrai: idempotent-migration

ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "isPinned" boolean DEFAULT false NOT NULL;
