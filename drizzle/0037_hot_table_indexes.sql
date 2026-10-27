-- mirrai: idempotent-migration
--
-- The tables every turn touches had no index at all.
--
-- `messages` is the one every turn reads and writes: loading a
-- conversation, paging back through it, the daily counts, the streak,
-- and the lobby's "when did the user last speak". It is also the
-- largest table in the instance — and it had no index, so all of that
-- was a sequential scan over every message of every user.
--
-- The same was true of the collected history (up to twenty thousand
-- rows a persona, read by every distillation), the uploaded files
-- (including the extracted text, the largest thing the app holds for
-- one persona), the memories, the personas and the distillation runs.
--
-- So the app got slower and slower as the instance accumulated
-- history, and on a shared database each user's queries scanned every
-- other user's rows too.

CREATE INDEX IF NOT EXISTS "messages_persona_user_created_idx"
  ON "messages" ("personaId", "userId", "createdAt");

CREATE INDEX IF NOT EXISTS "messages_user_role_created_idx"
  ON "messages" ("userId", "role", "createdAt");

CREATE INDEX IF NOT EXISTS "personas_user_idx"
  ON "personas" ("userId");

CREATE INDEX IF NOT EXISTS "memories_persona_user_idx"
  ON "memories" ("personaId", "userId");

CREATE INDEX IF NOT EXISTS "collected_messages_persona_user_idx"
  ON "collected_messages" ("personaId", "userId");

CREATE INDEX IF NOT EXISTS "persona_files_persona_user_idx"
  ON "persona_files" ("personaId", "userId");

CREATE INDEX IF NOT EXISTS "skill_jobs_persona_user_idx"
  ON "skill_jobs" ("personaId", "userId");

-- The summary of a conversation is read on every turn.
CREATE INDEX IF NOT EXISTS "chat_summaries_persona_user_created_idx"
  ON "chat_summaries" ("personaId", "userId", "createdAt");

-- The safety record is read by the panel and counted by the lobby.
CREATE INDEX IF NOT EXISTS "safety_events_user_created_idx"
  ON "safety_events" ("userId", "createdAt");

-- mirrai: down
DROP INDEX IF EXISTS "messages_persona_user_created_idx";
DROP INDEX IF EXISTS "messages_user_role_created_idx";
DROP INDEX IF EXISTS "personas_user_idx";
DROP INDEX IF EXISTS "memories_persona_user_idx";
DROP INDEX IF EXISTS "collected_messages_persona_user_idx";
DROP INDEX IF EXISTS "persona_files_persona_user_idx";
DROP INDEX IF EXISTS "skill_jobs_persona_user_idx";
DROP INDEX IF EXISTS "chat_summaries_persona_user_created_idx";
DROP INDEX IF EXISTS "safety_events_user_created_idx";
