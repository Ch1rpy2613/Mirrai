-- mirrai: idempotent-migration
--
-- The persona a channel talks to when a conversation has no binding of
-- its own.
--
-- A Feishu conversation only learns its id when the first message
-- arrives, so the choice cannot be made per conversation from the
-- interface — and the interface had no choice to make at all, so the
-- channel could never answer.

CREATE TABLE IF NOT EXISTS "channel_default_personas" (
  "id" SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "channel" VARCHAR(32) NOT NULL,
  "personaId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "channel_default_personas_user_channel_idx"
  ON "channel_default_personas" ("userId", "channel");

-- mirrai: down
DROP TABLE IF EXISTS "channel_default_personas";
