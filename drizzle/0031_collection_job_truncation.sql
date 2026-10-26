-- mirrai: idempotent-migration
--
-- The collection job could not say that it had been cut short.
--
-- The count that was kept was the same as the count that was found, so
-- a collection that stopped at the limit said it had found exactly as
-- many messages as it kept — and the rest were simply gone.

ALTER TABLE "collection_jobs"
  ADD COLUMN IF NOT EXISTS "foundCount" integer DEFAULT 0 NOT NULL;
ALTER TABLE "collection_jobs"
  ADD COLUMN IF NOT EXISTS "truncated" boolean DEFAULT false NOT NULL;

-- The rows that are already there keep their count.
UPDATE "collection_jobs"
SET "foundCount" = "messageCount"
WHERE "foundCount" = 0 AND "messageCount" > 0;

-- mirrai: down
ALTER TABLE "collection_jobs" DROP COLUMN IF EXISTS "truncated";
ALTER TABLE "collection_jobs" DROP COLUMN IF EXISTS "foundCount";
