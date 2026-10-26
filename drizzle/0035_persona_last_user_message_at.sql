-- mirrai: idempotent-migration
--
-- The moment the user last spoke to a persona.
--
-- The same column was used for two things: "the last time anything was
-- written" and "the last time the user spoke". The app's own nightly
-- message reset the second one, so the "you have not spoken for N days"
-- counter read 0 while the user had not spoken for a week -- and the
-- persona never reached out to a user who had gone quiet.
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "lastUserMessageAt" timestamp;

-- mirrai: down
-- The column is dropped again. The old behaviour — one column for two
-- questions — comes back, which is why this is a rollback and not a
-- mistake.
ALTER TABLE "personas" DROP COLUMN IF EXISTS "lastUserMessageAt";
