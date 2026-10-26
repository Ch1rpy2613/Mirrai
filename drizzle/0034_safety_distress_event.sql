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
-- A Postgres enum value cannot be removed without rebuilding the type,
-- so this migration has no way back. The value is harmless if it stays:
-- nothing writes it except the safety layer, and an old build ignores it.
