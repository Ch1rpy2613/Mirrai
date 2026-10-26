-- mirrai: idempotent-migration
--
-- The extraction log holds one row per persona and user.
--
-- The row records when the last extraction ran, so there is only ever
-- one of them. The write says "do nothing on a conflict" — but there
-- was no constraint for a conflict to happen on, so a row was added
-- every time and the log grew for ever.
--
-- The rows that are already there are folded down to the newest of
-- each pair first, so the constraint can be added.

DELETE FROM "memory_extractions" "old"
USING "memory_extractions" "newer"
WHERE "old"."personaId" = "newer"."personaId"
  AND "old"."userId" = "newer"."userId"
  AND "old"."extractedAt" < "newer"."extractedAt";

CREATE UNIQUE INDEX IF NOT EXISTS "memory_extractions_persona_user_unique"
  ON "memory_extractions" ("personaId", "userId");

-- mirrai: down
DROP INDEX IF EXISTS "memory_extractions_persona_user_unique";
