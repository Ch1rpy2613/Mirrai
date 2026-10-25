-- Mirrai: the user's own side, and what really happened in the relationship
--
-- 1. users.addressStyle / users.boundaries. The persona is rebuilt from the
--    other person's chat history, so it knows how *they* talk and has no
--    idea how the user wants to be called, or what the user no longer
--    wants to hear about.
--
-- 2. user_moods. The app modelled the persona and never the person:
--    everything the user felt was inferred from what they said *to* the
--    persona and stored as the persona's mood. The analytics page charted
--    the AI's feelings on the user's own dashboard. This is the table
--    where the user's own state is recorded.
--
-- 3. relationship_events. The app simulated a conversation and remembered
--    the other person's milestones, but it had nowhere to record reality:
--    that they fought, got back together, broke up, or are simply out of
--    touch. Without that, the persona's sense of the relationship was
--    frozen at whatever the distillation pipeline decided on the day it
--    ran.
--
-- Every statement is written so that running the file twice is safe.
-- mirrai: idempotent-migration

-- ─── the user's own profile ─────────────────────────────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "addressStyle" varchar(64);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "boundaries" text;

-- Whether the app may read the user's own messages to assess their
-- emotional trajectory. The trajectory is the one place where a month of
-- raw private conversation goes to the model, so it gets a switch.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "trajectoryAssessment" varchar(8) DEFAULT 'auto' NOT NULL;

-- ─── the user's own moods ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_moods" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL REFERENCES "users"("id"),
  "date" varchar(10) NOT NULL,
  "mood" varchar(16) NOT NULL,
  "note" text,
  "source" varchar(16) DEFAULT 'manual' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

-- One entry per day. Checking in again replaces the day's entry, so
-- recording stays cheap and repeatable.
CREATE UNIQUE INDEX IF NOT EXISTS "user_moods_user_date_idx"
  ON "user_moods" ("userId", "date");

-- ─── what really happened ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "relationship_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL REFERENCES "users"("id"),
  "personaId" integer NOT NULL REFERENCES "personas"("id"),
  "kind" varchar(24) NOT NULL,
  "title" varchar(200) NOT NULL,
  "detail" text,
  "happenedAt" timestamp DEFAULT now() NOT NULL,
  "recordedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "relationship_events_persona_time_idx"
  ON "relationship_events" ("personaId", "happenedAt");
