#!/usr/bin/env bash
# One-command desktop update: rebuild the unsigned arm64 app, reinstall it into
# /Applications, and relaunch — WITHOUT touching your data.
#
# Your board lives in ~/Library/Application Support/StoryDeck/ (userData), which
# is separate from the app bundle, so reinstalling never affects your stories.
#
# Usage: ./tools/update-app.sh

set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="StoryDeck"
INSTALLED="/Applications/${APP_NAME}.app"
BUILT="dist/mac-arm64/${APP_NAME}.app"
DB="$HOME/Library/Application Support/${APP_NAME}/todo.db"

echo "==> Pre-flight: tests must pass before we ship"
if ! node --test >/tmp/storydeck-update-test.log 2>&1; then
  echo "ERROR: tests failed — aborting update. See /tmp/storydeck-update-test.log" >&2
  tail -5 /tmp/storydeck-update-test.log >&2
  exit 1
fi
echo "    tests green"

# Safety net: snapshot the current DB before we swap anything.
if [ -f "$DB" ]; then
  SNAP="$HOME/StoryDeck-backups/pre-update-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$SNAP"
  cp -p "$DB" "$SNAP/" 2>/dev/null || true
  [ -f "$DB-wal" ] && cp -p "$DB-wal" "$SNAP/" 2>/dev/null || true
  [ -f "$DB-shm" ] && cp -p "$DB-shm" "$SNAP/" 2>/dev/null || true
  echo "==> Data snapshot: $SNAP"
fi

echo "==> Building unsigned arm64 app…"
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --arm64 >/tmp/storydeck-update-build.log 2>&1 || {
  echo "ERROR: build failed. See /tmp/storydeck-update-build.log" >&2
  tail -15 /tmp/storydeck-update-build.log >&2
  exit 1
}
[ -d "$BUILT" ] || { echo "ERROR: build produced no app at $BUILT" >&2; exit 1; }

echo "==> Quitting any running ${APP_NAME}…"
osascript -e "quit app \"${APP_NAME}\"" 2>/dev/null || true
pkill -f "${APP_NAME}.app/Contents/MacOS/${APP_NAME}" 2>/dev/null || true
sleep 1.5

echo "==> Reinstalling to ${INSTALLED} (your data is untouched)…"
rm -rf "$INSTALLED"
cp -R "$BUILT" /Applications/
xattr -dr com.apple.quarantine "$INSTALLED" 2>/dev/null || true

echo "==> Relaunching…"
open "$INSTALLED"

echo ""
echo "=== UPDATE COMPLETE ==="
echo "  installed: $(stat -f '%Sm' "$INSTALLED")"
echo "  dmg:       dist/${APP_NAME}-*-mac-arm64.dmg (share this to install elsewhere)"
