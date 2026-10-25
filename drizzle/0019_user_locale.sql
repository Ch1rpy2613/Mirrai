-- Mirrai: the language the user reads
--
-- The interface asks for the language on every request, but the things
-- the app sends on its own — a reminder at midnight, a reply in a chat
-- window — have to know it without being asked.
--
-- mirrai: idempotent-migration

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locale" varchar(8) NOT NULL DEFAULT 'zh';
