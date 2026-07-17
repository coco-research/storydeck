#!/usr/bin/env bash
# Publish hot-update CONTENT to the PUBLIC mirror so installed apps can pull it.
#
# The source repo (coco-research/storydeck) is PRIVATE, and raw.githubusercontent
# can't serve private repos unauthenticated. This pushes ONLY the updatable
# content — web/, src/, and content-manifest.json — to a public mirror, so no
# history, docs, tooling, or private data is exposed.
#
# Usage: ./tools/push-updates.sh
#
# The updater in the app fetches from this repo (src/updater.js CONTENT_REPO).

set -euo pipefail
cd "$(dirname "$0")/.."

MIRROR_REPO="${STORYDECK_UPDATE_REPO:-coco-research/storydeck-content}"

echo "==> Tests must pass before publishing content"
node --test >/tmp/storydeck-push-updates-test.log 2>&1 || {
  echo "ERROR: tests failed — not publishing. See /tmp/storydeck-push-updates-test.log" >&2
  tail -5 /tmp/storydeck-push-updates-test.log >&2
  exit 1
}

echo "==> Regenerating manifest"
node tools/make-manifest.cjs

TOKEN="$(gh auth token --user rijulkalra2000 2>/dev/null || gh auth token 2>/dev/null || true)"
if [ -z "$TOKEN" ]; then
  echo "ABORT: no gh token available to push to ${MIRROR_REPO}." >&2
  exit 1
fi

# Assemble a clean content-only tree in a temp dir.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/pub"
cp -R web "$STAGE/pub/web"
cp -R src "$STAGE/pub/src"
cp content-manifest.json "$STAGE/pub/content-manifest.json"

# Guard: never publish anything that looks like a secret or private overlay.
LEAK="$(cd "$STAGE/pub" && find . -type f \( -name '.env' -o -name '*.db' -o -name '*.db-*' -o -name 'seed.json' \) 2>/dev/null || true)"
if [ -n "$LEAK" ]; then
  echo "ABORT: refusing to publish potential secrets:" >&2
  echo "$LEAK" >&2
  exit 1
fi

VER="$(node -e "console.log(require('./content-manifest.json').contentVersion)")"

cd "$STAGE/pub"
git init -q
git checkout -q -b main
git -c user.name="StoryDeck Dev" -c user.email="dev@storydeck.local" add -A
git -c user.name="StoryDeck Dev" -c user.email="dev@storydeck.local" commit -q -m "Publish StoryDeck content v${VER}"

URL="https://x-access-token:${TOKEN}@github.com/${MIRROR_REPO}.git"
# Content mirror keeps no history — force-push a single fresh commit each time.
git -c credential.helper= push -f "$URL" HEAD:main 2>&1 | sed -E "s#https://[^@]*@#https://#g"

echo ""
echo "=== PUBLISHED content v${VER} to ${MIRROR_REPO} ==="
echo "  installed apps will pull it on next launch"
