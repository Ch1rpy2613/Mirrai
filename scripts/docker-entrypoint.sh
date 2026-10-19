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
pnpm db:push

echo "[Mirrai] Starting server..."
exec node dist/index.js
