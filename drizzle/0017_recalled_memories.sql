-- Mirrai: which memories a turn recalled
--
-- The persona brings up something from three months ago, and there has
-- to be a way to see that it was recalled rather than invented. It has
-- to be written down, or the answer disappears the moment the page is
-- reloaded.
--
-- mirrai: idempotent-migration

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "recalledMemoryIds" text;
