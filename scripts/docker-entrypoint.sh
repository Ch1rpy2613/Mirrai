#!/bin/sh
set -e

echo "[Mirrai] Waiting for database..."
until node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(() => c.end()).then(() => process.exit(0)).catch(() => process.exit(1));
" 2>/dev/null; do
  sleep 2
done

echo "[Mirrai] Applying database schema..."
# The push has to be told not to ask.
#
# `drizzle-kit push` asks before it does anything that could lose data,
# and it asks whether or not it is in "strict" mode. In a container
# there is no terminal to answer the question, so the prompt itself
# fails — and drizzle-kit catches that failure and exits zero. The
# container then starts on a half-synced schema, serving errors.
#
# The desktop builds have used `--force` all along.
pnpm db:push -- --force

echo "[Mirrai] Applying data migrations..."
# The failure is fatal.
#
# A failed data migration is exactly the case where the schema and the
# data disagree — the old Chinese intimacy levels mapped onto the new
# keys, the letters and their reachability, the outbound letters. The
# container used to carry on and serve wrong or empty data with no
# error at all.
node scripts/migrate.mjs

echo "[Mirrai] Starting server..."
exec node dist/index.js
