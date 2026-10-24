-- Mirrai: persona origin, pipeline retry counter, a distinct structuring stage
--
-- 1. personas.source records where a persona came from — distilled from chat
--    logs, filled in by the guided questionnaire, or imported from a
--    SillyTavern character card. The plan asks for it so the origin is a
--    fact rather than something inferred from a free-text message.
-- 2. skill_jobs.retryCount counts how often a failed distillation job has
--    been retried. Without it a job that failed can only ever be "failed".
-- 3. pipeline_stage gains "structuring". The structurer stage used to write
--    "merging", which made the two indistinguishable to a consumer. The
--    existing rows keep their value — PostgreSQL cannot rewrite an enum
--    value in place, and the distinction only matters for new runs.
--
-- Every statement is written so that running the file twice is safe.
-- mirrai: idempotent-migration

-- ─── pipeline_stage: add "structuring" ───────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t
                 JOIN pg_enum e ON e.enumtypid = t.oid
                 WHERE t.typname = 'pipeline_stage' AND e.enumlabel = 'structuring') THEN
    ALTER TYPE "pipeline_stage" ADD VALUE 'structuring';
  END IF;
END$$;

-- ─── personas: where the persona came from ──────────────────────────────────
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "source" varchar(32) DEFAULT 'upload' NOT NULL;

-- Existing personas were all distilled from uploaded chat logs.
UPDATE "personas" SET "source" = 'upload' WHERE "source" IS NULL OR "source" = '';

-- ─── skill_jobs: retry counter ──────────────────────────────────────────────
ALTER TABLE "skill_jobs" ADD COLUMN IF NOT EXISTS "retryCount" integer DEFAULT 0 NOT NULL;
