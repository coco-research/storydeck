#!/usr/bin/env bash
# Commit the current change and push the PUBLIC build to coco-research/storydeck.
#
# Safety: aborts if anything private is tracked. The private/ overlay, DB files,
# backups, and .env are gitignored and must never be committed.
#
# Auth: pushes with the rijulkalra2000 GitHub token (it has write access; the
# active McKinsey account rijul-mck does not). The global active gh account is
# NOT changed — the token is used only for this push.
#
# Usage: ./tools/push-public.sh "commit message"

set -euo pipefail
cd "$(dirname "$0")/.."

MSG="${1:-Update StoryDeck}"
REPO="coco-research/storydeck"
IDENT=(-c user.name="StoryDeck Dev" -c user.email="dev@storydeck.local")

git add -A

# ── Guard: no private data may be tracked ────────────────────────────────────
LEAK="$(git ls-files | grep -E 'private/|seed\.json$|\.db$|\.db-|backups/|(^|/)\.env$' || true)"
if [ -n "$LEAK" ]; then
  echo "ABORT: private/sensitive files are tracked — refusing to push:" >&2
  echo "$LEAK" >&2
  exit 1
fi

# ── Commit (skip if nothing changed) ─────────────────────────────────────────
if git diff --cached --quiet; then
  echo "No staged changes to commit."
else
  git "${IDENT[@]}" commit -q -m "$MSG"
  echo "committed: $MSG"
fi

# ── Push with the pushing account's token (no active-account change) ─────────
TOKEN="$(gh auth token --user rijulkalra2000 2>/dev/null || true)"
if [ -z "$TOKEN" ]; then
  echo "ABORT: no token for rijulkalra2000 (gh auth login as that user)." >&2
  exit 1
fi
URL="https://x-access-token:${TOKEN}@github.com/${REPO}.git"

# Fast-forward if the remote moved; keep our files on any conflict.
git -c credential.helper= fetch "$URL" main >/dev/null 2>&1 || true
git "${IDENT[@]}" merge --no-edit -X ours FETCH_HEAD >/dev/null 2>&1 || true

git -c credential.helper= push "$URL" HEAD:main 2>&1 | sed -E "s#https://[^@]*@#https://#g"
echo "pushed to ${REPO} (main)"
