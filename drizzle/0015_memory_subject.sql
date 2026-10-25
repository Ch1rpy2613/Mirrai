-- Mirrai: whose memory is it?
--
-- "them" is about the persona, "me" is about the user. A persona that
-- treats the two the same ends up talking about the user's own life as
-- if it were the persona's.
--
-- mirrai: idempotent-migration

ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "subject" varchar(8) DEFAULT 'them' NOT NULL;

-- The extraction log.
--
-- The extraction used to be a button, and pressing it twice stored the
-- same memories twice. It now runs on its own, at most once a day, and
-- it needs to know when it last ran.
CREATE TABLE IF NOT EXISTS "memory_extractions" (
  "id" serial PRIMARY KEY,
  "personaId" integer NOT NULL,
  "userId" integer NOT NULL,
  "extractedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "memory_extractions_persona_idx" ON "memory_extractions" ("personaId", "userId");
