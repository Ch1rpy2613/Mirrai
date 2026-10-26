-- Mirrai: the ruler for "does it still sound like them"
--
-- Every test in this project checks a mechanism. None of them check
-- whether the rebuilt persona still sounds like the person it was built
-- from — so there was no way to tell an improvement from a change.
--
-- These two tables hold that ruler: the held-out exchanges, and the runs
-- that scored them.
--
-- mirrai: idempotent-migration

CREATE TABLE IF NOT EXISTS "eval_cases" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "contextJson" jsonb NOT NULL,
  "expectedJson" jsonb NOT NULL,
  "expectedState" varchar(32),
  "source" varchar(32) DEFAULT 'collected' NOT NULL,
  "occurredAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "eval_cases_persona_idx" ON "eval_cases" ("personaId");

CREATE TABLE IF NOT EXISTS "eval_runs" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "metricsJson" jsonb NOT NULL,
  "personaSnapshot" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- mirrai: down
--
-- The way back. A migration that cannot be undone cannot be rolled
-- back, so every migration in this phase carries its own.
--

DROP TABLE IF EXISTS "eval_cases";
DROP TABLE IF EXISTS "eval_runs";
