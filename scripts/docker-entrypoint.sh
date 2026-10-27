#!/bin/sh
set -e

echo "[Mirrai] Waiting for database..."
# The wait is bounded.
#
# The loop had no limit — so a database that never came up (an address
# that is wrong, a password that no longer fits, a network that is not
# there yet) left the container starting for ever, saying "waiting for
# database" and never saying why.
attempt=0
until node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(() => c.end()).then(() => process.exit(0)).catch(() => process.exit(1));
" 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "[Mirrai] The database did not become available after 120 seconds." >&2
    exit 1
  fi
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
# The schema is pushed with drizzle-kit directly.
#
# It used to go through `pnpm`, and the package manager is not needed
# to run one script: it wanted a cache in the root's own home, and the
# app does not run as root.
node node_modules/drizzle-kit/bin.cjs push --force

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
