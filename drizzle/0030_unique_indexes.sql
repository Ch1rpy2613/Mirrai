-- mirrai: idempotent-migration
--
-- Two tables that were written with a read and then a write, so two
-- requests that passed the read together both wrote.
--
-- `diary_entries`: two entries for one day, and the user billed twice
-- for one generation.
--
-- `collection_sources`: two rows for one source, and the reader took
-- the first of an unordered select — possibly the older credentials.

-- The rows that are already there are folded down first, so the
-- constraint can be added.
DELETE FROM "diary_entries" "old"
USING "diary_entries" "newer"
WHERE "old"."personaId" = "newer"."personaId"
  AND "old"."userId" = "newer"."userId"
  AND "old"."date" = "newer"."date"
  AND "old"."id" > "newer"."id";

CREATE UNIQUE INDEX IF NOT EXISTS "diary_entries_persona_user_date_idx"
  ON "diary_entries" ("personaId", "userId", "date");

DELETE FROM "collection_sources" "old"
USING "collection_sources" "newer"
WHERE "old"."userId" = "newer"."userId"
  AND "old"."source" = "newer"."source"
  AND "old"."id" > "newer"."id";

CREATE UNIQUE INDEX IF NOT EXISTS "collection_sources_user_source_idx"
  ON "collection_sources" ("userId", "source");

-- mirrai: down
DROP INDEX IF EXISTS "diary_entries_persona_user_date_idx";
DROP INDEX IF EXISTS "collection_sources_user_source_idx";
