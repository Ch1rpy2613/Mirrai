-- mirrai: idempotent-migration
--
-- The extraction needs to say that one is already running.
--
-- The extraction is a read and then a write: the window of messages is
-- read, the model is asked about it, and what it says is stored. Two of
-- them running at once read the same window — so the model was asked
-- the same question twice (the user paid twice), and both stored what
-- they were told, so the same memory was in the panel twice.
--
-- The mark is on the row that already records the extraction, so it is
-- shared by every process of the app. A set in one process's memory
-- would not be: two instances of the app would each have their own,
-- and the user paid for both.
--
-- The column is nullable and starts empty: nothing is running.

ALTER TABLE "memory_extractions"
  ADD COLUMN IF NOT EXISTS "runningAt" timestamp;

-- mirrai: down
ALTER TABLE "memory_extractions" DROP COLUMN IF EXISTS "runningAt";
