-- mirrai: idempotent-migration
--
-- The claim on a letter becomes a timestamp rather than a status.
--
-- A sweep used to mark a letter "answered" before it had an answer, so
-- that two sweeps could not both write one. But the answer takes a model
-- call, and if the process stopped in between, the letter was left
-- "answered" with nothing in it — for ever, because only "waiting"
-- letters are picked up.
--
-- The claim is now a timestamp on a letter that is still "waiting", and a
-- claim that has gone stale belongs to a process that is no longer
-- running.

ALTER TABLE "letters" ADD COLUMN IF NOT EXISTS "claimedAt" timestamp;

CREATE INDEX IF NOT EXISTS "letters_claimed_idx" ON "letters" ("status", "claimedAt");

-- mirrai: down
DROP INDEX IF EXISTS "letters_claimed_idx";
ALTER TABLE "letters" DROP COLUMN IF EXISTS "claimedAt";
