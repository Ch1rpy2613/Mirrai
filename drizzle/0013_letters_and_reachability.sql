-- Mirrai: letters, and the distance between two people
--
-- 1. The "letters" table. The app had one way to say something: talk to
--    it, and get an answer. But the things people most want to say to
--    somebody they cannot reach are the things they cannot say *to*
--    them — and sometimes the answer is the problem. A letter can be
--    kept and never answered, or delivered. A delivered letter is
--    answered a day later, because instant replies are the one thing
--    that gives the game away.
--
-- 2. personas.reachability. "We are apart" and "we broke up" were the
--    same thing, so a person who was simply out of touch — a long trip,
--    a stretch of silence — was treated as though it were over. A
--    distance is not a breakup, and now the app can say so.
--
-- Every statement is written so that running the file twice is safe.
-- mirrai: idempotent-migration

-- ─── letters ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "letters" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL REFERENCES "users"("id"),
  "personaId" integer NOT NULL REFERENCES "personas"("id"),
  "body" text NOT NULL,
  -- "letter" is something written to the persona. "todo" is 「等 TA 回来再说」
  -- — a note to yourself, kept for the moment the two of you are in touch
  -- again.
  "kind" varchar(16) DEFAULT 'letter' NOT NULL,
  "mood" varchar(16),
  "status" varchar(16) DEFAULT 'private' NOT NULL,
  "replyAt" timestamp,
  "repliedAt" timestamp,
  "replyText" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "letters_persona_time_idx"
  ON "letters" ("personaId", "createdAt");

-- The scheduler looks for the letters whose reply is due.
CREATE INDEX IF NOT EXISTS "letters_reply_due_idx"
  ON "letters" ("status", "replyAt");

-- ─── reachability ───────────────────────────────────────────────────────────
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "reachability" varchar(16) DEFAULT 'reachable' NOT NULL;

-- ─── the persona reaching out first ─────────────────────────────────────────
-- How often the persona may start a conversation on its own, in hours.
-- Zero means never, and it is the default: an app that speaks first is
-- something the user has to buy, not something they get by default.
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "proactiveFrequencyHours" integer DEFAULT 0 NOT NULL;
