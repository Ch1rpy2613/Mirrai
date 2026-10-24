-- Mirrai: switch the WeChat channel from the unofficial Wechaty puppet to the
-- official Tencent iLink backend used by the WeChat "ClawBot" plugin.
--
-- 1. wechat_bindings: the conversation counterpart is now the account owner's
--    own Weixin id (ilink_user_id) instead of a third-party friend's id, so
--    the column is renamed. A partial unique index keeps one default persona
--    per (user, WeChat account) while leaving legacy rows untouched.
-- 2. wechat_bot_state: stores the iLink credentials, the long-poll cursor and
--    the last inbound timestamp. The bot token is stored encrypted.
-- 3. bot_status: gains the "need_verifycode" state, used when WeChat asks the
--    user to type the numeric code shown in the app.
--
-- Every statement is written so that running the file twice is safe.
-- mirrai: idempotent-migration
--
-- NOTE: this file used to carry no marker, so `pnpm db:migrate` skipped it.
-- That was wrong: 0005 reads `wechat_bindings"."wechatUserId"`, so an install
-- that jumped from a pre-ClawBot version straight to the current release
-- would have failed on the column rename. The marker makes it run.

-- ── bot_status enum ────────────────────────────────────────────────────────
-- PostgreSQL cannot remove enum values, but it can add them. Existing values
-- keep their meaning; "scaned" and "need_verifycode" slot in between
-- "scanning" and "logged_in".
ALTER TYPE "public"."bot_status" ADD VALUE IF NOT EXISTS 'need_verifycode';
ALTER TYPE "public"."bot_status" ADD VALUE IF NOT EXISTS 'scaned';

-- ── wechat_bindings: semantic reversal ─────────────────────────────────────
-- The rename is conditional on purpose. A fresh install bootstraps the final
-- schema in one shot (`drizzle-kit push`), so "wechatContactId" does not exist
-- there and the statement has to be a no-op. On an existing install the column
-- is still there and gets renamed.
--
-- The legacy cleanup lives inside the same block on purpose. Legacy rows
-- pointed at third-party friends, which no longer has a meaning under the
-- ClawBot model (the counterpart is always the account owner), so they are
-- deactivated rather than dropped. Deactivating them is only correct while
-- the rename is actually happening — running it unconditionally would wipe
-- the active bindings of an install that had already been migrated.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'wechat_bindings'
      AND column_name = 'wechatContactId'
  ) THEN
    ALTER TABLE "wechat_bindings" RENAME COLUMN "wechatContactId" TO "wechatUserId";

    -- Legacy rows pointed at third-party friends, which no longer has a
    -- meaning under the ClawBot model (the counterpart is always the account
    -- owner). Deactivate them rather than dropping user data; they can still
    -- be removed from the UI.
    UPDATE "wechat_bindings" SET "isActive" = false WHERE "isActive" = true;
  END IF;
END $$;

-- One active default persona per (user, WeChat account). Partial, because
-- inactive legacy rows may share the same counterpart id.
CREATE UNIQUE INDEX IF NOT EXISTS "wechat_bindings_user_wechat_idx"
  ON "wechat_bindings" USING btree ("userId", "wechatUserId")
  WHERE "isActive" = true;

-- ── wechat_bot_state: iLink credentials and cursor ─────────────────────────
ALTER TABLE "wechat_bot_state" ADD COLUMN IF NOT EXISTS "botTokenEnc" text;
ALTER TABLE "wechat_bot_state" ADD COLUMN IF NOT EXISTS "accountId" varchar(255);
ALTER TABLE "wechat_bot_state" ADD COLUMN IF NOT EXISTS "baseUrl" text;
ALTER TABLE "wechat_bot_state" ADD COLUMN IF NOT EXISTS "wechatUserId" varchar(255);
ALTER TABLE "wechat_bot_state" ADD COLUMN IF NOT EXISTS "syncBuf" text;
ALTER TABLE "wechat_bot_state" ADD COLUMN IF NOT EXISTS "lastInboundAt" timestamp;
