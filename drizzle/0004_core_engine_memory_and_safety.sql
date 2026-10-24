-- Mirrai: core engine — memory retrieval, conversation compaction, safety
-- layer (phase 1)
--
-- 1. memories gains weighting and recall-tracking columns, plus the
--    "anchor" category for facts the persona must never contradict.
-- 2. chat_summaries keeps a rolling summary of the conversation that fell
--    out of the context window.
-- 3. safety_events records interventions (crisis, usage, dependency,
--    graduation trajectory). These never leave the machine.
-- 4. graduation_assessments tracks the emotional trajectory over time.
--
-- Every statement is written so that running the file twice is safe.
-- mirrai: idempotent-migration

-- ─── memory_category: add "anchor" ──────────────────────────────────────────
-- PostgreSQL cannot remove enum values but can add them. Older rows keep
-- their meaning.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t
                 JOIN pg_enum e ON e.enumtypid = t.oid
                 WHERE t.typname = 'memory_category' AND e.enumlabel = 'anchor') THEN
    ALTER TYPE "memory_category" ADD VALUE 'anchor';
  END IF;
END$$;

-- ─── channel: add "feishu" ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t
                 JOIN pg_enum e ON e.enumtypid = t.oid
                 WHERE t.typname = 'channel' AND e.enumlabel = 'feishu') THEN
    ALTER TYPE "channel" ADD VALUE 'feishu';
  END IF;
END$$;

-- ─── memories: retrieval metadata ───────────────────────────────────────────
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "importance" integer NOT NULL DEFAULT 1;
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "isPinned" boolean NOT NULL DEFAULT false;
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "lastRecalledAt" timestamp;
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "factKey" varchar(120);

-- ─── chat_summaries ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "chat_summaries" (
  "id" serial PRIMARY KEY NOT NULL,
  "personaId" integer NOT NULL,
  "userId" integer NOT NULL,
  "summary" text NOT NULL,
  "fromMessageId" integer,
  "toMessageId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- ─── safety_events ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'safety_event_type') THEN
    CREATE TYPE "safety_event_type" AS ENUM('crisis', 'usage', 'dependency', 'graduation_trajectory');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'safety_event_severity') THEN
    CREATE TYPE "safety_event_severity" AS ENUM('info', 'warning', 'critical');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "safety_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer,
  "type" "safety_event_type" NOT NULL,
  "severity" "safety_event_severity" DEFAULT 'info' NOT NULL,
  "excerpt" text,
  "handled" boolean DEFAULT false NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "resolvedAt" timestamp
);

-- ─── graduation_assessments ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "graduation_assessments" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "windowStart" timestamp NOT NULL,
  "windowEnd" timestamp NOT NULL,
  "trajectory" varchar(32) NOT NULL,
  "regretRatio" integer DEFAULT 0 NOT NULL,
  "gratitudeRatio" integer DEFAULT 0 NOT NULL,
  "assessment" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- ─── personas: intimacy level becomes a locale-neutral key ───────────────────
-- The level used to be stored as a Chinese label, which the UI could not
-- localise. Map the existing labels onto stable keys.
UPDATE "personas" SET "intimacyLevel" = 'acquainted' WHERE "intimacyLevel" IN ('初识', 'acquainted');
UPDATE "personas" SET "intimacyLevel" = 'familiar'   WHERE "intimacyLevel" IN ('熟悉', 'familiar');
UPDATE "personas" SET "intimacyLevel" = 'intimate'   WHERE "intimacyLevel" IN ('亲密', 'intimate');
UPDATE "personas" SET "intimacyLevel" = 'confidant'  WHERE "intimacyLevel" IN ('知己', 'confidant');
UPDATE "personas" SET "intimacyLevel" = 'soulmate'   WHERE "intimacyLevel" IN ('灵魂伴侣', 'soulmate');

ALTER TABLE "personas" ALTER COLUMN "intimacyLevel" SET DEFAULT 'acquainted';
