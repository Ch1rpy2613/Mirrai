-- Mirrai: collectors, templates, questionnaires and reminders (phases 2-4)
--
-- Every statement is written so that running the file twice is safe.
-- mirrai: idempotent-migration

-- ─── file_type: collected material ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t
                 JOIN pg_enum e ON e.enumtypid = t.oid
                 WHERE t.typname = 'file_type' AND e.enumlabel = 'collected') THEN
    ALTER TYPE "file_type" ADD VALUE 'collected';
  END IF;
END$$;

-- ─── pipeline_stage: the celebrity research stages ─────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t
                 JOIN pg_enum e ON e.enumtypid = t.oid
                 WHERE t.typname = 'pipeline_stage' AND e.enumlabel = 'researching') THEN
    ALTER TYPE "pipeline_stage" ADD VALUE 'researching';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t
                 JOIN pg_enum e ON e.enumtypid = t.oid
                 WHERE t.typname = 'pipeline_stage' AND e.enumlabel = 'auditing') THEN
    ALTER TYPE "pipeline_stage" ADD VALUE 'auditing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t
                 JOIN pg_enum e ON e.enumtypid = t.oid
                 WHERE t.typname = 'pipeline_stage' AND e.enumlabel = 'synthesizing') THEN
    ALTER TYPE "pipeline_stage" ADD VALUE 'synthesizing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t
                 JOIN pg_enum e ON e.enumtypid = t.oid
                 WHERE t.typname = 'pipeline_stage' AND e.enumlabel = 'validating') THEN
    ALTER TYPE "pipeline_stage" ADD VALUE 'validating';
  END IF;
END$$;

-- ─── skill_jobs: the research profile ──────────────────────────────────────
ALTER TABLE "skill_jobs" ADD COLUMN IF NOT EXISTS "researchProfile" varchar(32);

-- ─── research_profiles ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "research_profiles" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "profile" varchar(32) NOT NULL,
  "notes" jsonb,
  "audit" jsonb,
  "synthesis" jsonb,
  "validation" jsonb,
  "qualityReport" jsonb,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- ─── collection_sources ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "collection_sources" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "source" varchar(32) NOT NULL,
  "label" varchar(100),
  "authState" jsonb,
  "config" jsonb,
  "status" varchar(32) DEFAULT 'stopped' NOT NULL,
  "lastSyncedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- ─── collection_jobs ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "collection_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "jobKey" varchar(64) NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer,
  "source" varchar(32) NOT NULL,
  "status" varchar(32) DEFAULT 'queued' NOT NULL,
  "progress" integer DEFAULT 0 NOT NULL,
  "messageCount" integer DEFAULT 0 NOT NULL,
  "error" text,
  "rawPath" text,
  "startedAt" timestamp,
  "finishedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- The stable job identifier, so a client can keep polling across a restart.
ALTER TABLE "collection_jobs" ADD COLUMN IF NOT EXISTS "jobKey" varchar(64) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS "collection_jobs_job_key_idx"
  ON "collection_jobs" ("jobKey");

-- ─── collected_messages ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "collected_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "source" varchar(32) NOT NULL,
  "role" varchar(16) NOT NULL,
  "content" text NOT NULL,
  "timestamp" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- ─── persona_templates ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "persona_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer,
  "templateId" varchar(100) NOT NULL,
  "name" varchar(100) NOT NULL,
  "family" varchar(32) NOT NULL,
  "description" text,
  "tags" jsonb,
  "personaData" jsonb NOT NULL,
  "scenePack" jsonb,
  "author" varchar(100),
  "license" varchar(64),
  "schemaVersion" integer DEFAULT 1 NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- ─── persona_questionnaire_answers ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "persona_questionnaire_answers" (
  "id" serial PRIMARY KEY NOT NULL,
  "personaId" integer NOT NULL,
  "userId" integer NOT NULL,
  "answers" jsonb NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- ─── reminder_deliveries ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "reminder_deliveries" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "channel" varchar(32) NOT NULL,
  "kind" varchar(32) NOT NULL,
  "text" text,
  "dedupeKey" varchar(200) NOT NULL,
  "scheduledFor" timestamp NOT NULL,
  "deliveredAt" timestamp,
  "dismissedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- The text column was added after the table first shipped.
ALTER TABLE "reminder_deliveries" ADD COLUMN IF NOT EXISTS "text" text;

CREATE UNIQUE INDEX IF NOT EXISTS "reminder_deliveries_dedupe_idx"
  ON "reminder_deliveries" ("userId", "dedupeKey");
