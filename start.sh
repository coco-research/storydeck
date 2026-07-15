#!/usr/bin/env bash
# Start the local StoryDeck server.
# Frees port 4321 if a stale server is holding it, then boots.
# API keys + optional model are read from .env / private/.env automatically
# (see src/env.js), so you do NOT need to export anything here.
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-4321}"
lsof -ti "tcp:${PORT}" | xargs kill -9 2>/dev/null || true
sleep 0.3

# AI is enabled if ANY provider key is present (private overlay wins, then root .env).
ai_key=""
for f in private/.env .env; do
  [ -f "$f" ] || continue
  if grep -qE '^[[:space:]]*(OPENAI_API_KEY|ANTHROPIC_API_KEY|CURSOR_API_KEY)=.+' "$f"; then
    ai_key="$f"; break
  fi
done
if [ -n "$ai_key" ]; then
  echo "AI assistant: ENABLED (provider key found in $ai_key)"
else
  echo "AI assistant: disabled (no OPENAI/ANTHROPIC/CURSOR key — the ask bar returns 503)"
fi

exec node src/server.js
