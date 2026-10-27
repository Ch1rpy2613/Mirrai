-- mirrai: idempotent-migration
--
-- The source's own id for a collected message.
--
-- The timestamp is what tells two messages apart — and a message
-- without one can only be told apart by its text and by how many times
-- that text has been seen. The collectors return a *window*, not the
-- whole history, so the window moves: a new message with no time of its
-- own gets the occurrence number of one that is already stored, and it
-- is never imported.
--
-- This is the source's own identifier — Feishu's `message_id`, Slack's
-- `ts`, the page's `data-message-id` — and it does not change.
--
-- It is nullable: the rows collected before this column existed have
-- none, and giving them one would mean guessing at which of two
-- identical messages came first. Those rows keep being matched the way
-- they were.

ALTER TABLE "collected_messages"
  ADD COLUMN IF NOT EXISTS "sourceMessageId" text;

-- mirrai: down
ALTER TABLE "collected_messages" DROP COLUMN IF EXISTS "sourceMessageId";
