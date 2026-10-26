-- Mirrai: how this persona behaves over time
--
-- The profile is what makes the waiting theirs rather than the app's,
-- so it is kept on the persona next to everything else that describes
-- them.
--
-- The plan said this column needed no SQL, on the grounds that
-- `personaData` is jsonb. That was true of the *fields* inside
-- `personaData`, and not true of this: `behaviorProfile` is a column of
-- its own on `personas`, so it needs the same `ALTER TABLE` as every
-- other column. Without it, an upgraded install fails on every read of
-- a persona — the column is selected with the rest of them.
--
-- mirrai: idempotent-migration

ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "behaviorProfile" jsonb;

-- mirrai: down
--
-- The way back. A migration that cannot be undone cannot be rolled
-- back, so every migration in this phase carries its own.
--

ALTER TABLE "personas" DROP COLUMN IF EXISTS "behaviorProfile";
