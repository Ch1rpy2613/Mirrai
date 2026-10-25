-- Mirrai: quoting a message
--
-- Without a way to reply to a *particular* message, every reply is a
-- reply to "whatever came last". A conversation that has been going for
-- a while becomes impossible to follow — and following it is the thing
-- people are in these conversations to do.
--
-- mirrai: idempotent-migration

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "replyToId" integer;
