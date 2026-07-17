#!/usr/bin/env bash
# Build an unsigned macOS arm64 .dmg for StoryDeck.
# First launch: right-click the app → Open (Gatekeeper blocks unsigned apps on double-click).

set -euo pipefail
cd "$(dirname "$0")/.."

# Preflight: free dev server port and run tests
lsof -ti tcp:4321 | xargs kill -9 2>/dev/null || true

echo "Running tests..."
if ! node --test; then
  echo "ERROR: Tests failed — aborting build." >&2
  exit 1
fi

echo "Building unsigned arm64 dmg..."
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --arm64

DMG="$(find dist -maxdepth 1 -name '*.dmg' -type f | head -n 1)"
if [ -z "$DMG" ]; then
  echo "ERROR: Build finished but no .dmg found in dist/" >&2
  exit 1
fi

echo "Success: $DMG"
