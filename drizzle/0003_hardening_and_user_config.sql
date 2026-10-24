-- Mirrai: hardening and per-user configuration (phase 0)
--
-- 1. users.tokenVersion — lets a logout or a password change invalidate
--    sessions that were issued earlier.
-- 2. llm_configs.apiKeyHint — the last four characters of the key, so the
--    settings page can show which key is configured without revealing it.
--
-- Every statement is written so that running the file twice is safe.
-- mirrai: idempotent-migration

-- ─── users.tokenVersion ─────────────────────────────────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tokenVersion" integer NOT NULL DEFAULT 0;

-- ─── llm_configs.apiKeyHint ────────────────────────────────────────────────
ALTER TABLE "llm_configs" ADD COLUMN IF NOT EXISTS "apiKeyHint" varchar(16);

-- ─── schema_migrations (bookkeeping for scripts/migrate.mjs) ───────────────
CREATE TABLE IF NOT EXISTS "schema_migrations" (
  "version" varchar(64) PRIMARY KEY NOT NULL,
  "appliedAt" timestamp DEFAULT now() NOT NULL
);
