-- mirrai: idempotent-migration
--
-- The safety layer notices ordinary distress — the wording of a
-- message says the person is worn out — and it changes what the
-- persona says. But nothing was written down, so the panel that says
-- "what the app noticed" did not show it.
--
-- Postgres 12 and later allow a new enum value inside a transaction,
-- as long as it is not used in the same one — and this migration only
-- adds it.

ALTER TYPE "safety_event_type" ADD VALUE IF NOT EXISTS 'distress';

-- mirrai: down
-- The value is removed by rebuilding the type.
--
-- A Postgres enum value cannot be dropped — the type has to be
-- rebuilt around it. So the rows that carry the value go first (they
-- are the safety layer's own records of ordinary distress, and a build
-- that does not know the value cannot read them), the column is moved
-- onto the new type, and the old type is dropped.
--
-- This section used to be a comment only — so the rollback ran, said
-- it had rolled back, and changed nothing. A rollback that says it
-- worked and did nothing is worse than one that refuses to start.
DELETE FROM "safety_events" WHERE "type" = 'distress';

ALTER TYPE "safety_event_type" RENAME TO "safety_event_type_old";

CREATE TYPE "safety_event_type" AS ENUM (
  'crisis',
  'usage',
  'dependency',
  'graduation_trajectory'
);

ALTER TABLE "safety_events"
  ALTER COLUMN "type" TYPE "safety_event_type"
  USING "type"::text::"safety_event_type";

DROP TYPE "safety_event_type_old";
