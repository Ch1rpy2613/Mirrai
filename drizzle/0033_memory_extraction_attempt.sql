-- mirrai: idempotent-migration
--
-- The extraction's window only moved when the answer could be read.
--
-- So a model that answered with prose instead of JSON left it where it
-- was — and the next turn paid for another call, and the next, and the
-- next. The attempt is a separate column now.

ALTER TABLE "memory_extractions"
  ADD COLUMN IF NOT EXISTS "lastAttemptAt" timestamp DEFAULT now() NOT NULL;

UPDATE "memory_extractions"
SET "lastAttemptAt" = "extractedAt"
WHERE "lastAttemptAt" IS NULL;

-- mirrai: down
ALTER TABLE "memory_extractions" DROP COLUMN IF EXISTS "lastAttemptAt";
