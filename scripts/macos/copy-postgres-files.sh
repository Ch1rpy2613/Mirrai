#!/bin/bash
set -euo pipefail

# ─── The PostgreSQL half of the macOS bundle ─────────────────────────────────
# Copies the PostgreSQL binaries, libraries and data files into the app
# bundle.
#
# It is a script of its own so that it can be *run* — the build used to
# swallow every failure here:
#
#   cp -R "$PG_PREFIX/share/"* "$PG_DEST/share/" 2>/dev/null || true
#
# So a build where the copy failed went on, the .dmg was made, and the
# app failed on the user's own machine: at first launch, with a message
# about a missing file and nothing to connect it to the build. The data
# files are the ones `initdb` reads — the time zone data, the locale
# data, the bootstrap files — and without them the packaged app cannot
# create its own database at all.
#
# Usage: copy-postgres-files.sh <prefix> <destination>

log() { echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

[ $# -eq 2 ] || die "Usage: $0 <prefix> <destination>"

PG_PREFIX="$1"
PG_DEST="$2"

[ -d "$PG_PREFIX/bin" ] || die "PostgreSQL binaries not found at $PG_PREFIX/bin"

mkdir -p "$PG_DEST/bin" "$PG_DEST/lib" "$PG_DEST/share"

PG_BINS="postgres pg_ctl initdb createdb psql pg_isready"
for bin in $PG_BINS; do
  if [ -f "$PG_PREFIX/bin/$bin" ]; then
    cp "$PG_PREFIX/bin/$bin" "$PG_DEST/bin/"
    chmod +x "$PG_DEST/bin/$bin"
  else
    log "Warning: $bin not found, skipping"
  fi
done

# The shared libraries.
cp -R "$PG_PREFIX/lib/"*.dylib "$PG_DEST/lib/" 2>/dev/null || \
  die "Could not copy the PostgreSQL libraries from $PG_PREFIX/lib"
cp -R "$PG_PREFIX/lib/postgresql" "$PG_DEST/lib/" 2>/dev/null || \
  die "Could not copy $PG_PREFIX/lib/postgresql"

# The data files, which `initdb` reads.
if ! cp -R "$PG_PREFIX/share/postgresql@16/"* "$PG_DEST/share/" 2>/dev/null; then
  cp -R "$PG_PREFIX/share/"* "$PG_DEST/share/" 2>/dev/null || \
    die "Could not copy the PostgreSQL data files from $PG_PREFIX/share"
fi
# The check is not the copy: a copy that "succeeded" can still have
# copied nothing.
[ -n "$(ls -A "$PG_DEST/share/" 2>/dev/null)" ] || \
  die "The PostgreSQL data files are missing from the bundle (initdb would fail on the user's machine)"

log "PostgreSQL copied into $PG_DEST"
