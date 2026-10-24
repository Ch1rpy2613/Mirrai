#!/bin/bash
set -euo pipefail

# ─── Paths ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RES="$SCRIPT_DIR"
NODE_BIN="$RES/node/bin/node"
PG_DIR="$RES/pgsql"
APP_DIR="$RES/app"

DATA_ROOT="$HOME/Library/Application Support/Mirrai"
PG_DATA="$DATA_ROOT/pgdata"
UPLOADS="$DATA_ROOT/uploads"
LOGS="$DATA_ROOT/logs"
PG_LOG="$LOGS/postgresql.log"
PG_PORT=5433
PG_USER="mirrai"
DB_NAME="mirrai"

export PATH="$PG_DIR/bin:$RES/node/bin:$PATH"
export DYLD_LIBRARY_PATH="$PG_DIR/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
export DYLD_FALLBACK_LIBRARY_PATH="$PG_DIR/lib"
export PGSHAREDIR="$PG_DIR/share"
export LC_ALL=C
export LANG=C

# ─── Helpers ─────────────────────────────────────────────────────────────────
log() { echo "[Mirrai] $*"; }

cleanup() {
  log "Shutting down..."
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null && wait "$SERVER_PID" 2>/dev/null
  if [ -f "$PG_DATA/postmaster.pid" ]; then
    "$PG_DIR/bin/pg_ctl" -D "$PG_DATA" -m fast stop 2>/dev/null || true
  fi
  log "Stopped. You can close this window."
}
trap cleanup EXIT INT TERM

wait_for_pg() {
  local i=0
  while [ $i -lt 30 ]; do
    if "$PG_DIR/bin/pg_isready" -h localhost -p "$PG_PORT" -q 2>/dev/null; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║          Mirrai is starting...       ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# ─── Ensure data directories ─────────────────────────────────────────────────
mkdir -p "$PG_DATA" "$UPLOADS" "$LOGS"

# ─── PostgreSQL: init if needed ──────────────────────────────────────────────
if [ ! -f "$PG_DATA/PG_VERSION" ]; then
  log "Initializing database (first run)..."
  "$PG_DIR/bin/initdb" \
    -D "$PG_DATA" \
    -U "$PG_USER" \
    -A trust \
    --encoding=UTF8 \
    --locale=C \
    > "$LOGS/initdb.log" 2>&1

  if [ $? -ne 0 ]; then
    log "ERROR: Database init failed. Log:"
    cat "$LOGS/initdb.log"
    read -rp "Press Enter to exit..."
    exit 1
  fi

  echo "port = $PG_PORT" >> "$PG_DATA/postgresql.conf"
  echo "unix_socket_directories = '/tmp'" >> "$PG_DATA/postgresql.conf"
  echo "listen_addresses = 'localhost'" >> "$PG_DATA/postgresql.conf"
  log "Database initialized."
fi

# ─── PostgreSQL: start ───────────────────────────────────────────────────────
if [ -f "$PG_DATA/postmaster.pid" ]; then
  if "$PG_DIR/bin/pg_isready" -h localhost -p "$PG_PORT" -q 2>/dev/null; then
    log "PostgreSQL already running."
  else
    log "Cleaning stale PID file..."
    rm -f "$PG_DATA/postmaster.pid"
  fi
fi

if [ ! -f "$PG_DATA/postmaster.pid" ]; then
  log "Starting PostgreSQL on port $PG_PORT..."
  "$PG_DIR/bin/pg_ctl" \
    -D "$PG_DATA" \
    -l "$PG_LOG" \
    start > /dev/null 2>&1

  if ! wait_for_pg; then
    log "ERROR: PostgreSQL failed to start. Log:"
    tail -20 "$PG_LOG"
    read -rp "Press Enter to exit..."
    exit 1
  fi
  log "PostgreSQL started."
fi

# ─── Create database if needed ───────────────────────────────────────────────
log "Ensuring database '$DB_NAME' exists..."
CREATE_OUT=$("$PG_DIR/bin/psql" -h localhost -p "$PG_PORT" -U "$PG_USER" -d postgres \
  -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME';" 2>&1)

if echo "$CREATE_OUT" | grep -q "1"; then
  log "Database '$DB_NAME' already exists."
else
  log "Creating database '$DB_NAME'..."
  "$PG_DIR/bin/createdb" -h localhost -p "$PG_PORT" -U "$PG_USER" "$DB_NAME" 2>&1 || \
    "$PG_DIR/bin/psql" -h localhost -p "$PG_PORT" -U "$PG_USER" -d postgres \
      -c "CREATE DATABASE $DB_NAME;" 2>&1 || {
    log "ERROR: Could not create database '$DB_NAME'."
    tail -5 "$PG_LOG"
    read -rp "Press Enter to exit..."
    exit 1
  }
  log "Database '$DB_NAME' created."
fi

# ─── Environment ─────────────────────────────────────────────────────────────
export DATABASE_URL="postgresql://${PG_USER}@localhost:${PG_PORT}/${DB_NAME}"
export NODE_ENV=production
export PORT=3000
export UPLOAD_DIR="$UPLOADS"

ENV_FILE="$DATA_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [ -z "${JWT_SECRET:-}" ]; then
  if [ ! -f "$DATA_ROOT/.jwt_secret" ]; then
    openssl rand -hex 32 > "$DATA_ROOT/.jwt_secret"
  fi
  export JWT_SECRET
  JWT_SECRET=$(cat "$DATA_ROOT/.jwt_secret")
fi

# ─── Database migration ─────────────────────────────────────────────────────
# The WeChat channel changed the meaning of the binding table, so the
# hand-written migration runs first - but only when the table is already
# there. On a fresh database there is nothing to rename yet, and push below
# creates the final schema in one go.
log "Applying the WeChat channel migration..."
HAS_BINDINGS=$("$PG_DIR/bin/psql" -h localhost -p "$PG_PORT" -U "$PG_USER" -d "$DB_NAME" \
  -tAc "SELECT to_regclass('public.wechat_bindings') IS NOT NULL;" 2>/dev/null | tr -d '[:space:]')

if [ "$HAS_BINDINGS" = "t" ]; then
  MIGRATION="$APP_DIR/drizzle/0002_wechat_clawbot_channel.sql"
  if [ -f "$MIGRATION" ]; then
    "$PG_DIR/bin/psql" -h localhost -p "$PG_PORT" -U "$PG_USER" -d "$DB_NAME" \
      --single-transaction -v ON_ERROR_STOP=1 -f "$MIGRATION" 2>&1 | tee -a "$LOGS/migrate.log" || \
      log "Migration note (may be OK)"
  fi
else
  log "No existing bindings table, the schema will be created below."
fi

# `drizzle-kit push` compares schema.ts against the live database and applies
# the difference. Unlike `migrate` it does not need a migration journal, which
# is not shipped with the app.
log "Synchronizing the database schema..."
cd "$APP_DIR"
"$NODE_BIN" ./node_modules/drizzle-kit/bin.cjs push --force 2>&1 | tee -a "$LOGS/migrate.log" || \
  log "Schema sync note (may be OK)"

# `push` only creates the tables — it does not run the hand-written data
# migrations (for example mapping the old Chinese intimacy levels onto the new
# keys). Those are idempotent SQL files, applied in order.
log "Applying data migrations..."
"$NODE_BIN" scripts/migrate.mjs 2>&1 | tee -a "$LOGS/migrate.log" || \
  log "Data migration note (may be OK)"

# ─── Create .env template for user ──────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" << 'ENVEOF'
# Mirrai Configuration
# Edit this file to configure your AI provider.
# After editing, restart Mirrai for changes to take effect.

# AI Provider (at least one required)
# Options: openai, deepseek, claude, kimi, ollama, tongyi, doubao, 302ai, dify, xunfei
DEFAULT_LLM_PROVIDER=openai
OPENAI_API_KEY=

# DeepSeek (alternative)
# DEEPSEEK_API_KEY=

# Claude (alternative)
# CLAUDE_API_KEY=
ENVEOF
  log "Created config at: $ENV_FILE"
fi

# ─── Start server ────────────────────────────────────────────────────────────
log "Starting Mirrai server..."
cd "$APP_DIR"
"$NODE_BIN" dist/index.js &
SERVER_PID=$!

sleep 2
for i in $(seq 1 20); do
  if curl -sf "http://localhost:${PORT}/" > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

open "http://localhost:${PORT}"

echo ""

# On a fresh install the server creates a local administrator and writes the
# credentials here. Show them — otherwise the operator cannot sign in.
CRED_FILE="$DATA_ROOT/first-run-credentials.txt"
for i in $(seq 1 10); do
  [ -f "$CRED_FILE" ] && break
  sleep 1
done
if [ -f "$CRED_FILE" ]; then
  log "Administrator account created / 管理员账号已生成:"
  echo ""
  cat "$CRED_FILE"
  echo ""
  log "Please change this password after signing in. / 请登录后尽快修改密码。"
  echo ""
fi

log "Mirrai is running at http://localhost:${PORT}"
log "Config: $ENV_FILE"
echo ""
log "Press Ctrl+C or close this window to stop."
echo ""

wait "$SERVER_PID" 2>/dev/null || true
