-- Mirrai: the persona correction loop (phase 2)
--
-- `personas.correctionLog` keeps a record of the corrections the user has
-- made to a persona, so a change is auditable rather than silent.
--
-- Every statement is written so that running the file twice is safe.
-- mirrai: idempotent-migration

ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "correctionLog" jsonb;
