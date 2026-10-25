-- Mirrai: graduation modes, distillation presets, and a unique built-in scene name
--
-- 1. users.graduationMode is the instance-wide default for the graduation
--    mechanism. The default is "suggest", which is exactly what the app did
--    before the column existed, so an existing installation keeps its
--    behaviour after the upgrade.
-- 2. personas.graduationMode is the per-persona override. It is NULL for
--    every existing row, which means "inherit the user's default" — again,
--    no behaviour change.
-- 3. personas.distillationMode remembers which distillation preset a persona
--    was built with. It is NULL for every existing row, which means the
--    standard preset, which is what the app did before the presets existed.
-- 4. scenes gets a partial unique index on the name of the built-in scenes.
--    The seeding routine identifies a built-in scene by its name, so two rows
--    with the same name would be indistinguishable. Existing installations
--    may have duplicate rows from before the index existed, so they are
--    de-duplicated first — the oldest row of each name is kept.
--
-- Every statement is written so that running the file twice is safe.
-- mirrai: idempotent-migration

-- ─── users: the instance-wide graduation default ────────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "graduationMode" varchar(16) DEFAULT 'suggest' NOT NULL;

-- ─── personas: the per-persona graduation override ──────────────────────────
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "graduationMode" varchar(16);

-- ─── personas: the distillation preset the persona was built with ───────────
ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "distillationMode" varchar(32);

-- ─── scenes: one built-in scene per name ────────────────────────────────────
-- Keep the oldest row of each duplicated name and drop the rest.
DELETE FROM "scenes" a USING "scenes" b
  WHERE a."id" > b."id" AND a."name" = b."name" AND a."isBuiltin" = true;

CREATE UNIQUE INDEX IF NOT EXISTS "scenes_builtin_name_idx" ON "scenes" ("name") WHERE "isBuiltin" = true;
