-- mirrai: idempotent-migration
--
-- Two promises that were kept by a read, and a read is a read.
--
-- The WeChat bot state holds the encrypted bot token and the long-poll
-- cursor. It was written by a read-then-insert, and nothing stopped
-- two of them at once — so two concurrent first writes left the user
-- with two rows, and the read (which took the first row the database
-- felt like returning) did not necessarily return the one that had the
-- token in it. The button said "connected" — the chip comes from the
-- process's memory — and the monitor said "no credentials" and the bot
-- never polled.
--
-- The outbound letters are the user's own words, offered back to them.
-- The duplicate was prevented by the router reading the list first, so
-- two collects at once (a double-click, two tabs) both decided the same
-- message was new, and both inserted. That list exists so the user can
-- take their own words back — twice is not a gift.

-- The rows that are already there.
--
-- Only the newest of each user's rows is kept: it is the one the
-- monitor would have read, and the older ones are dead weight.
DELETE FROM "wechat_bot_state" a
  USING "wechat_bot_state" b
  WHERE a."userId" = b."userId" AND a."id" < b."id";

CREATE UNIQUE INDEX IF NOT EXISTS "wechat_bot_state_user_unique_idx"
  ON "wechat_bot_state" ("userId");

-- The same sentence, offered once.
--
-- It is partial: a letter the user wrote themselves has no source
-- message, and two of those are two different letters.
CREATE UNIQUE INDEX IF NOT EXISTS "outbound_letters_source_unique_idx"
  ON "outbound_letters" ("personaId", "sourceMessageId")
  WHERE "sourceMessageId" IS NOT NULL;

-- mirrai: down
DROP INDEX IF EXISTS "outbound_letters_source_unique_idx";
DROP INDEX IF EXISTS "wechat_bot_state_user_unique_idx";
