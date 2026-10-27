-- mirrai: idempotent-migration
--
-- The extraction's window only moved when the answer could be read.
--
-- So a model that answered with prose instead of JSON left it where it
-- was — and the next turn paid for another call, and the next, and the
-- next. The attempt is a separate column now.

-- The column is added *without* the not-null first.
--
-- It was added with `DEFAULT now() NOT NULL` — so every row that was
-- already there was stamped with the moment the migration ran, and the
-- backfill below (which looks for the rows that have no value yet)
-- matched **nothing**: the column is never null, because it cannot be.
--
-- So every extraction that had already run was stamped as "attempted
-- just now", and the window that decides whether to try again was wrong
-- for the whole table.
ALTER TABLE "memory_extractions"
  ADD COLUMN IF NOT EXISTS "lastAttemptAt" timestamp;

-- The rows that were there before the column existed get the time they
-- were actually extracted at.
UPDATE "memory_extractions"
SET "lastAttemptAt" = "extractedAt"
WHERE "lastAttemptAt" IS NULL;

-- And then the column is made what the schema says it is.
--
-- The guard is there because the migration has to run twice without
-- failing: `SET NOT NULL` on a column that is already not null is an
-- error, and a migration that fails on the second run is a migration
-- that breaks every install that runs it again.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'memory_extractions'
      AND column_name = 'lastAttemptAt'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE "memory_extractions" ALTER COLUMN "lastAttemptAt" SET NOT NULL;
  END IF;
END $$;

ALTER TABLE "memory_extractions"
  ALTER COLUMN "lastAttemptAt" SET DEFAULT now();

-- mirrai: down
ALTER TABLE "memory_extractions" DROP COLUMN IF EXISTS "lastAttemptAt";
