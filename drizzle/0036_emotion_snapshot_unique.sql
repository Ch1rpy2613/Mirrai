-- mirrai: idempotent-migration
--
-- The emotion snapshot holds one row per persona, user and day.
--
-- The row was written by a read and then a write: the turn looked for
-- today's snapshot, and wrote one when there was none. So two requests
-- that passed the read together — a double send, two tabs, the chat
-- and the channel at the same moment — both wrote a row, and the day
-- had two snapshots. The reader took one of them (there was no order
-- to take them in) and the other stayed for ever, so the count of the
-- days that had a snapshot was wrong, and the second row was never
-- updated again.
--
-- The rows that are already there are folded down to the newest of
-- each day first, so the constraint can be added.

DELETE FROM "emotion_snapshots" "old"
USING "emotion_snapshots" "newer"
WHERE "old"."personaId" = "newer"."personaId"
  AND "old"."userId" = "newer"."userId"
  AND "old"."date" = "newer"."date"
  AND "old"."id" > "newer"."id";

CREATE UNIQUE INDEX IF NOT EXISTS "emotion_snapshots_persona_user_date_idx"
  ON "emotion_snapshots" ("personaId", "userId", "date");

-- mirrai: down
DROP INDEX IF EXISTS "emotion_snapshots_persona_user_date_idx";
