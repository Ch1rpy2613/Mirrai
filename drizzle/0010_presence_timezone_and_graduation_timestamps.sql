-- Mirrai: presence, timezones, and graduation timestamps
--
-- 1. users.timezone / personas.timezone. The app used the server's clock
--    for the time-of-day awareness, so a persona in another timezone was
--    greeted as if it were the user's own evening. The persona's timezone
--    is the one that decides what time it is *for them*.
--
-- 2. personas.presence separates the *company* from the *ritual*.
--    graduationStatus records whether the goodbye has happened; presence
--    records whether the app may reach out at all:
--      active — reachable, outreach allowed
--      quiet  — the user asked for space; no outreach, no suggestions
--      asleep — graduated; must not disturb anyone
--    The default is "active", which is what every existing row means, so
--    the upgrade changes no behaviour.
--
-- 3. personas.graduationSuggestedAt / graduationDeclinedAt. The
--    trajectory branch used to offer a graduation on *every* turn, because
--    it never recorded that it had already done so. These two timestamps
--    let the offer happen once, and let a declined offer be made again
--    later without being nagging about it.
--
-- Every statement is written so that running the file twice is safe.
-- mirrai: idempotent-migration

-- ─── timezones ──────────────────────────────────────────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezone" varchar(64);
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "timezone" varchar(64);

-- ─── presence ───────────────────────────────────────────────────────────────
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "presence" varchar(16) DEFAULT 'active' NOT NULL;

-- A persona that has already graduated is asleep, whatever the column
-- said before it existed. (The column is NOT NULL, so the test is "is not
-- already asleep" rather than "is null".)
UPDATE "personas" SET "presence" = 'asleep'
WHERE "graduationStatus" = 'graduated' AND "presence" IS DISTINCT FROM 'asleep';

-- ─── graduation timestamps ──────────────────────────────────────────────────
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "graduationSuggestedAt" timestamp;
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "graduationDeclinedAt" timestamp;
