-- Mirrai: an index for the runs
--
-- The ruler is asked for the last run of a persona, and the runs are
-- looked up by persona and read newest-first. The table is small, but
-- the other two new tables carry an index and this one should too.
--
-- mirrai: idempotent-migration

CREATE INDEX IF NOT EXISTS "eval_runs_persona_idx" ON "eval_runs" ("personaId");

-- mirrai: down
--
-- The way back. A migration that cannot be undone cannot be rolled
-- back, so every migration in this phase carries its own.
--

DROP INDEX IF EXISTS "eval_runs_persona_idx";
