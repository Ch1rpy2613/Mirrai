#!/bin/bash
set -euo pipefail

# ─── Mirrai macOS App Builder ────────────────────────────────────────────────
# Builds a self-contained Mirrai.app with embedded Node.js and PostgreSQL,
# then packages it into a .dmg for distribution.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$PROJECT_DIR/build-macos"
APP_NAME="Mirrai"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"
CONTENTS="$APP_BUNDLE/Contents"
RESOURCES="$CONTENTS/Resources"
DMG_NAME="Mirrai-macOS-arm64"

NODE_VERSION="24.22.1"
NODE_ARCH="arm64"
NODE_TARBALL="node-v${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}"

log() { echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

# ─── Preflight checks ───────────────────────────────────────────────────────
log "Checking prerequisites..."

command -v brew >/dev/null 2>&1 || die "Homebrew is required. Install from https://brew.sh"

PG_PREFIX="$(brew --prefix postgresql@16 2>/dev/null || true)"
if [ -z "$PG_PREFIX" ] || [ ! -d "$PG_PREFIX" ]; then
  log "PostgreSQL 16 not found. Installing via Homebrew..."
  brew install postgresql@16
  PG_PREFIX="$(brew --prefix postgresql@16)"
fi

[ -d "$PG_PREFIX/bin" ] || die "PostgreSQL binaries not found at $PG_PREFIX/bin"
log "Using PostgreSQL from: $PG_PREFIX"

# ─── Clean previous build ───────────────────────────────────────────────────
log "Cleaning previous build..."
rm -rf "$BUILD_DIR"
mkdir -p "$CONTENTS/MacOS" "$RESOURCES"

# ─── Step 1: Build the project ───────────────────────────────────────────────
log "Building Mirrai project..."
cd "$PROJECT_DIR"
# Use the pnpm version pinned in package.json "packageManager" (via corepack),
# so lockfile overrides stay compatible across machines
corepack enable pnpm 2>/dev/null || true
corepack pnpm install --frozen-lockfile
# Drop packages that are no longer in the dependency tree. pnpm keeps them in
# .pnpm/, and a stale copy of an uninstalled dependency (wechaty and its
# transitive deps, for example) would otherwise be shipped inside the app.
corepack pnpm prune
corepack pnpm build

# ─── Step 2: Download Node.js ────────────────────────────────────────────────
log "Downloading Node.js v${NODE_VERSION} (${NODE_ARCH})..."
NODE_TMP="$BUILD_DIR/node-tmp"
mkdir -p "$NODE_TMP"

if [ ! -f "$BUILD_DIR/$NODE_TARBALL" ]; then
  curl -fSL "$NODE_URL" -o "$BUILD_DIR/$NODE_TARBALL"
fi
tar -xzf "$BUILD_DIR/$NODE_TARBALL" -C "$NODE_TMP" --strip-components=1

mkdir -p "$RESOURCES/node/bin"
cp "$NODE_TMP/bin/node" "$RESOURCES/node/bin/node"
chmod +x "$RESOURCES/node/bin/node"
log "Node.js binary ready."

# ─── Step 3: Copy PostgreSQL ─────────────────────────────────────────────────
log "Copying PostgreSQL binaries..."
PG_DEST="$RESOURCES/pgsql"
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

# Copy shared libraries
cp -R "$PG_PREFIX/lib/"*.dylib "$PG_DEST/lib/" 2>/dev/null || true
cp -R "$PG_PREFIX/lib/postgresql" "$PG_DEST/lib/" 2>/dev/null || true

# Copy share files (needed for initdb)
cp -R "$PG_PREFIX/share/postgresql@16/"* "$PG_DEST/share/" 2>/dev/null || \
  cp -R "$PG_PREFIX/share/"* "$PG_DEST/share/" 2>/dev/null || true

# ─── Step 3b: Bundle ALL Homebrew dependencies (recursive) ──────────────────
log "Collecting all Homebrew library dependencies..."

collect_homebrew_deps() {
  otool -L "$1" 2>/dev/null | awk '{print $1}' | grep -E "^/opt/homebrew|^/usr/local/(opt|Cellar)" || true
}

# Copies a directory's binaries and the libraries they need into itself, so
# that the bundle carries no path back to the build machine.
#
# It is used for PostgreSQL and for Redis, which have the same shape: the
# executables in `bin/`, the libraries in `lib/`, and the library paths
# rewritten to `@executable_path/../lib/…` and `@loader_path/…`.
bundle_binaries() {
  local dest="$1"

  # Iteratively resolve until no new deps are found
  local PREV_COUNT=0
  for round in 1 2 3 4 5; do
    local ALL_FILES=("$dest/bin/"* "$dest/lib/"*.dylib)
    local DEPS=""
    for f in "${ALL_FILES[@]}"; do
      [ -f "$f" ] || continue
      DEPS="$DEPS $(collect_homebrew_deps "$f")"
    done

    local COPIED=0
    for dep in $(echo "$DEPS" | tr ' ' '\n' | sort -u); do
      [ -f "$dep" ] || continue
      libname=$(basename "$dep")
      if [ ! -f "$dest/lib/$libname" ]; then
        cp "$dep" "$dest/lib/"
        chmod +w "$dest/lib/$libname"
        COPIED=$((COPIED + 1))
        log "  Round $round: copied $libname"
      fi
    done

    local CUR_COUNT=$(ls "$dest/lib/"*.dylib 2>/dev/null | wc -l)
    [ "$CUR_COUNT" -eq "$PREV_COUNT" ] && break
    PREV_COUNT=$CUR_COUNT
  done

  # ─── Fix ALL library paths ────────────────────────────────────────────────
  log "Fixing library paths (binaries)..."
  for bin in "$dest/bin/"*; do
    [ -f "$bin" ] || continue
    for lib in $(otool -L "$bin" 2>/dev/null | awk '{print $1}' | grep -E "^/opt/homebrew|^/usr/local/(opt|Cellar)"); do
      libname=$(basename "$lib")
      install_name_tool -change "$lib" "@executable_path/../lib/$libname" "$bin" 2>/dev/null || true
    done
  done

  log "Fixing library paths (dylibs)..."
  for dylib in "$dest/lib/"*.dylib; do
    [ -f "$dylib" ] || continue
    libname=$(basename "$dylib")
    install_name_tool -id "@loader_path/$libname" "$dylib" 2>/dev/null || true
    for dep in $(otool -L "$dylib" 2>/dev/null | awk '{print $1}' | grep -E "^/opt/homebrew|^/usr/local/(opt|Cellar)"); do
      depname=$(basename "$dep")
      install_name_tool -change "$dep" "@loader_path/$depname" "$dylib" 2>/dev/null || true
    done
  done

  # Verify no Homebrew paths remain
  log "Verifying library paths..."
  local REMAINING=$(for f in "$dest/bin/"* "$dest/lib/"*.dylib; do otool -L "$f" 2>/dev/null; done | grep -E "^\s+/opt/homebrew|^\s+/usr/local/(opt|Cellar)" || true)
  if [ -n "$REMAINING" ]; then
    log "WARNING: Some Homebrew paths still unresolved:"
    echo "$REMAINING"
  else
    log "All library paths resolved."
  fi

  # Re-sign all modified binaries (install_name_tool invalidates adhoc signatures)
  log "Re-signing binaries..."
  for f in "$dest/bin/"* "$dest/lib/"*.dylib; do
    [ -f "$f" ] || continue
    codesign --force --sign - "$f" 2>/dev/null || true
  done
}

bundle_binaries "$PG_DEST"

# ─── Step 3c: ICU data ─────────────────────────────────────────────────────
# The ICU data library is loaded with dlopen rather than linked, so the
# dependency walk above never sees it.
for icudir in "$(brew --prefix icu4c@78 2>/dev/null)/lib" "$(brew --prefix icu4c 2>/dev/null)/lib"; do
  [ -d "$icudir" ] || continue
  for f in "$icudir"/libicudata*.dylib; do
    [ -f "$f" ] || continue
    libname=$(basename "$f")
    if [ ! -f "$PG_DEST/lib/$libname" ]; then
      cp "$f" "$PG_DEST/lib/"
      chmod +w "$PG_DEST/lib/$libname"
      log "Copied ICU data: $libname"
    fi
  done
  break
done

log "PostgreSQL binaries ready."

# ─── Step 3d: Redis ────────────────────────────────────────────────────────
# The rate limiter and the scheduler lock live in Redis, so a person who
# installs Mirrai has to end up with one. Bundling it here is what makes
# that true: the app finds this binary and starts it itself, and the
# person never has to install, download or configure anything.
#
# The same shape as PostgreSQL — the executables in `bin/`, the libraries
# in `lib/` — so the server looks for it in the same place.
log "Copying Redis binaries..."
REDIS_PREFIX="$(brew --prefix redis 2>/dev/null || true)"
if [ -z "$REDIS_PREFIX" ] || [ ! -d "$REDIS_PREFIX/bin" ]; then
  log "Redis not found. Installing via Homebrew..."
  brew install redis
  REDIS_PREFIX="$(brew --prefix redis)"
fi

REDIS_DEST="$RESOURCES/redis"
mkdir -p "$REDIS_DEST/bin" "$REDIS_DEST/lib"

for bin in redis-server redis-cli; do
  if [ -f "$REDIS_PREFIX/bin/$bin" ]; then
    cp "$REDIS_PREFIX/bin/$bin" "$REDIS_DEST/bin/"
    chmod +x "$REDIS_DEST/bin/$bin"
  else
    log "Warning: $bin not found, skipping"
  fi
done

[ -f "$REDIS_DEST/bin/redis-server" ] || die "redis-server not found at $REDIS_PREFIX/bin"

bundle_binaries "$REDIS_DEST"

log "Redis binaries ready."

# ─── Step 4: Assemble app code ───────────────────────────────────────────────
log "Copying application code..."
APP_DEST="$RESOURCES/app"
mkdir -p "$APP_DEST"

cp -R "$PROJECT_DIR/dist" "$APP_DEST/"
cp -R "$PROJECT_DIR/drizzle" "$APP_DEST/"
# The templates that ship with the app. Without them the template
# library is empty and "try it out with a sandbox character" is
# impossible.
mkdir -p "$APP_DEST/server/templates"
cp -R "$PROJECT_DIR/server/templates/builtin" "$APP_DEST/server/templates/"
# The skill engine: the prompts the distillation reads at run time, and
# the Python collectors it drives.
#
# They were never shipped, so in the installed app every distillation
# stage failed with "Prompt not found" and the collectors were spawned
# in a directory that did not exist.
cp -R "$PROJECT_DIR/skill-engine" "$APP_DEST/skill-engine"
# The migration runner. The start script runs it out of the bundle, and
# it was not there — so the hand-written data migrations never ran on
# an installed app.
mkdir -p "$APP_DEST/scripts"
cp "$PROJECT_DIR/scripts/migrate.mjs" "$APP_DEST/scripts/migrate.mjs"
cp "$PROJECT_DIR/package.json" "$APP_DEST/"
cp "$PROJECT_DIR/drizzle.config.ts" "$APP_DEST/"

# Copy node_modules (full — the esbuild bundle uses --packages=external
# so runtime imports like vite, drizzle-kit etc. must be resolvable)
# pnpm's layout is symlink-based, so tar is used instead of cp: it preserves
# the links and keeps the .pnpm store in place. The IDE settings that some
# packages ship (.vscode, .idea) are excluded — they are never needed at
# runtime and some of them are not copyable.
log "Copying node_modules (this may take a moment)..."
tar -cf - -C "$PROJECT_DIR" \
    --exclude='.vscode' --exclude='.idea' \
    node_modules | tar -xf - -C "$APP_DEST"

# ─── Step 5: Info.plist ──────────────────────────────────────────────────────
log "Writing Info.plist..."
cp "$SCRIPT_DIR/macos/Info.plist" "$CONTENTS/Info.plist"

# ─── Step 6: Launcher + start script ─────────────────────────────────────────
log "Writing launcher and start scripts..."
cp "$SCRIPT_DIR/macos/launcher.sh" "$CONTENTS/MacOS/Mirrai"
chmod +x "$CONTENTS/MacOS/Mirrai"
cp "$SCRIPT_DIR/macos/start.sh" "$RESOURCES/start.sh"
chmod +x "$RESOURCES/start.sh"

# ─── Step 7: Create .dmg ────────────────────────────────────────────────────
log "Creating DMG..."
DMG_TMP="$BUILD_DIR/dmg-staging"
DMG_PATH="$BUILD_DIR/${DMG_NAME}.dmg"
rm -rf "$DMG_TMP" "$DMG_PATH"
mkdir -p "$DMG_TMP"

cp -R "$APP_BUNDLE" "$DMG_TMP/"

# Create a symlink to /Applications for drag-and-drop install
ln -s /Applications "$DMG_TMP/Applications"

# Create a README
cat > "$DMG_TMP/README.txt" << 'EOF'
Mirrai — AI Digital Persona Platform

Installation:
  Drag Mirrai.app to the Applications folder.

  Everything Mirrai needs is inside the app: Node.js, PostgreSQL and Redis.
  There is nothing else to download and nothing to configure.

First Launch:
  1. Double-click Mirrai in Applications
  2. If macOS blocks it: System Settings → Privacy & Security → Open Anyway
  3. A terminal window will open showing startup logs
  4. Your browser will open automatically to http://localhost:3000
  5. Register an account and start using Mirrai

Configuration:
  After first launch, edit the config file at:
  ~/Library/Application Support/Mirrai/.env

  Add your AI provider API key (OpenAI, DeepSeek, Claude, etc.)
  Then restart Mirrai for changes to take effect.

To Stop:
  Close the terminal window, or press Ctrl+C.

Notes:
  - Redis comes with Mirrai. It is started automatically when the app starts
    and stopped when it stops; it is what makes the rate limits mean the same
    thing when you run more than one copy.
EOF

hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$DMG_TMP" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

# ─── Done ────────────────────────────────────────────────────────────────────
DMG_SIZE=$(du -sh "$DMG_PATH" | awk '{print $1}')
log ""
log "Build complete!"
log "  App:  $APP_BUNDLE"
log "  DMG:  $DMG_PATH ($DMG_SIZE)"
log ""
log "To test: open '$DMG_PATH'"
