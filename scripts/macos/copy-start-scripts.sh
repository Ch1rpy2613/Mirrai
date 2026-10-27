#!/bin/bash
# ─── The start scripts, into the bundle ──────────────────────────────────────
#
# The launcher, the start script, and the .env reader.
#
# They are copied here rather than inline in the build script, so that
# the test can build the same bundle the build builds — and run it.
#
# The .env reader was left out of the bundle once, and the app died on
# every launch after the first: `source "$SCRIPT_DIR/load-env.sh"`
# failed, and the start script runs with `set -e`, so it ended there.
# The first launch worked (there is no .env yet, so the block is
# skipped) and every launch after it died with "No such file or
# directory". Nothing in the build noticed, because the build only
# copies files.
#
# Usage: copy-start-scripts.sh <scripts/macos directory> <Resources directory>
set -euo pipefail

SCRIPT_DIR="${1:?the scripts/macos directory is required}"
RESOURCES="${2:?the Resources directory is required}"
CONTENTS="$(dirname "$RESOURCES")"

cp "$SCRIPT_DIR/start.sh" "$RESOURCES/start.sh"
chmod +x "$RESOURCES/start.sh"

cp "$SCRIPT_DIR/load-env.sh" "$RESOURCES/load-env.sh"
chmod +x "$RESOURCES/load-env.sh"

cp "$SCRIPT_DIR/launcher.sh" "$CONTENTS/MacOS/Mirrai"
chmod +x "$CONTENTS/MacOS/Mirrai"
