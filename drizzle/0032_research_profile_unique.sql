-- mirrai: idempotent-migration
--
-- The research profiles were written with a plain insert.
--
-- The table says "one row per persona and profile" — but every
-- celebrity distillation added another row, and the table grew for the
-- life of the instance.

DELETE FROM "research_profiles" "old"
USING "research_profiles" "newer"
WHERE "old"."personaId" = "newer"."personaId"
  AND "old"."userId" = "newer"."userId"
  AND "old"."profile" = "newer"."profile"
  AND "old"."id" < "newer"."id";

CREATE UNIQUE INDEX IF NOT EXISTS "research_profiles_persona_profile_idx"
  ON "research_profiles" ("personaId", "userId", "profile");

-- mirrai: down
DROP INDEX IF EXISTS "research_profiles_persona_profile_idx";
