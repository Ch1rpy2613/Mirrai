-- mirrai: idempotent-migration
--
-- The collected history is not allowed to hold the same message twice.
--
-- The guarantee used to rest entirely on a read: the importer read the
-- keys that were already there, worked out which of the new ones were
-- new, and wrote the rest. Nothing in the database stopped two of
-- those from running at once.
--
-- So two instances of the app — or a second copy of the app on the same
-- database — both read the same table, both worked out the same new
-- messages, and both wrote them. The history was duplicated, and the
-- distillation that read it counted every message twice.
--
-- The key is stored with the message, and the database refuses the
-- second copy of it.
--
-- The column is nullable and the index only covers the rows that have
-- one. The rows collected before this column existed do not have one,
-- and giving them one would mean guessing at which of two identical
-- messages came first — a guess that is wrong exactly when it matters,
-- because it is the *repeated* messages ("嗯", "好的") that a chat log
-- is full of. The importer still recognises those rows by reading them,
-- so nothing is collected twice; the index is the backstop for the
-- rows that come after this migration.

ALTER TABLE "collected_messages"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" text;

CREATE UNIQUE INDEX IF NOT EXISTS "collected_messages_idempotency_unique_idx"
  ON "collected_messages" ("personaId", "userId", "idempotencyKey")
  WHERE "idempotencyKey" IS NOT NULL;

-- mirrai: down
DROP INDEX IF EXISTS "collected_messages_idempotency_unique_idx";
ALTER TABLE "collected_messages" DROP COLUMN IF EXISTS "idempotencyKey";
