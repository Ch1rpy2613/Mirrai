-- mirrai: idempotent-migration
--
-- The collection job needs two numbers, not one.
--
-- The message count is how many rows were *new* — the import is
-- idempotent, so re-collecting a history the user already imported
-- writes nothing, and the count says zero. That is the honest answer
-- for "how much did this add to the persona", and it is the number the
-- user reads.
--
-- But the collection still held every message it found, and the note
-- that says "only part of it was taken" needs *that* number: it wants
-- how many were kept out of the ones that were found, not how many
-- were new. With one number the note said "found 500, kept 0" — a
-- sentence that contradicts itself in a new way, right next to a
-- message count of zero.
--
-- So the kept count is its own column.

-- The column is nullable on purpose.
--
-- A row collected before this column existed has no kept count — and
-- that is not the same as having kept zero. `NOT NULL DEFAULT 0` would
-- turn "we do not know" into a number the user reads.
ALTER TABLE "collection_jobs"
  ADD COLUMN IF NOT EXISTS "keptCount" integer;

-- The rows that were already there.
--
-- They were collected before the two counts were apart: the message
-- count was the count of the collection. So that is what they kept.
-- Without this they would read "found 400, kept 0" — the exact
-- self-contradicting sentence the column was added to remove.
UPDATE "collection_jobs"
  SET "keptCount" = "messageCount"
  WHERE "keptCount" IS NULL;

-- mirrai: down
ALTER TABLE "collection_jobs" DROP COLUMN IF EXISTS "keptCount";
