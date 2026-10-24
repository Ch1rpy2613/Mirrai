-- Mirrai: channel-neutral conversation channels (phase 4)
--
-- The WeChat ClawBot channel keeps its own tables for one more release; these
-- are the channel-neutral tables that new channels (Feishu today) use, and
-- that the WeChat rows are copied into so the data is available in the
-- generic form.
--
-- Every statement is written so that running the file twice is safe.
-- mirrai: idempotent-migration

-- ─── channel_bindings ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "channel_bindings" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "channel" varchar(32) NOT NULL,
  "targetId" varchar(255) NOT NULL,
  "targetName" varchar(255),
  "personaId" integer NOT NULL,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "channel_bindings_user_channel_target_idx"
  ON "channel_bindings" ("userId", "channel", "targetId")
  WHERE "isActive" = true;

-- ─── channel_states ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "channel_states" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "channel" varchar(32) NOT NULL,
  "status" varchar(32) DEFAULT 'stopped' NOT NULL,
  "credentialsEnc" text,
  "cursor" text,
  "lastInboundAt" timestamp,
  "lastError" text,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "channel_states_user_channel_idx"
  ON "channel_states" ("userId", "channel");

-- ─── copy the WeChat rows into the generic tables ──────────────────────────
-- The iLink credentials stay encrypted; only the table changes.
DO $$
BEGIN
  IF to_regclass('public.wechat_bindings') IS NOT NULL THEN
    INSERT INTO "channel_bindings"
      ("userId", "channel", "targetId", "targetName", "personaId", "isActive", "createdAt")
    SELECT
      b."userId",
      'wechat',
      b."wechatUserId",
      b."wechatName",
      b."personaId",
      b."isActive",
      b."createdAt"
    FROM "wechat_bindings" b
    WHERE NOT EXISTS (
      SELECT 1 FROM "channel_bindings" c
      WHERE c."userId" = b."userId"
        AND c."channel" = 'wechat'
        AND c."targetId" = b."wechatUserId"
        AND c."isActive" = true
    );
  END IF;

  IF to_regclass('public.wechat_bot_state') IS NOT NULL THEN
    INSERT INTO "channel_states"
      ("userId", "channel", "status", "credentialsEnc", "cursor", "lastInboundAt", "lastError", "updatedAt")
    SELECT
      s."userId",
      'wechat',
      s."status",
      s."botTokenEnc",
      s."syncBuf",
      s."lastInboundAt",
      s."lastError",
      COALESCE(s."updatedAt", now())
    FROM "wechat_bot_state" s
    WHERE NOT EXISTS (
      SELECT 1 FROM "channel_states" c
      WHERE c."userId" = s."userId" AND c."channel" = 'wechat'
    );
  END IF;
END$$;

-- ─── personas: per-persona reminders ───────────────────────────────────────
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "remindersEnabled" boolean NOT NULL DEFAULT true;
