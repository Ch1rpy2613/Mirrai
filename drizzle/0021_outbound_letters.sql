-- Mirrai: the way out
--
-- Graduation ends with a farewell in the persona's voice. But what was
-- actually unfinished was never the persona's sentence — it was the
-- user's. They said things here that they never managed to say to the
-- person they were talking about, and saying them here was the useful
-- part.
--
-- So graduation gets an exit: the words that were only ever said to the
-- persona, collected and handed back. Nothing is sent by the app, and
-- nothing here is ever the persona's own writing.
--
-- mirrai: idempotent-migration

CREATE TABLE IF NOT EXISTS "outbound_letters" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL,
  "personaId" integer NOT NULL,
  "text" text NOT NULL,
  "sourceMessageId" integer,
  "status" varchar(16) DEFAULT 'draft' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  "sentAt" timestamp,
  "droppedAt" timestamp
);

CREATE INDEX IF NOT EXISTS "outbound_letters_persona_idx" ON "outbound_letters" ("personaId");
CREATE INDEX IF NOT EXISTS "outbound_letters_status_idx" ON "outbound_letters" ("status");

-- mirrai: down
--
-- The way back. A migration that cannot be undone cannot be rolled
-- back, so every migration in this phase carries its own.
--

DROP TABLE IF EXISTS "outbound_letters";
