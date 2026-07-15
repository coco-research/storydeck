#!/usr/bin/env bash
# Start the local Stories board server.
# Frees port 4321 if a stale server is holding it, then boots.
# The API key + optional model are read from .env automatically (see src/env.js),
# so you do NOT need to export anything here — just create .env from .env.example.
set -euo pipefail

cd "$(dirname "$0")"

PORT="${PORT:-4321}"
lsof -ti "tcp:${PORT}" | xargs kill -9 2>/dev/null || true
sleep 0.3

if [ -f .env ] && grep -q '^[[:space:]]*CURSOR_API_KEY=.\+' .env; then
  echo "AI assistant: ENABLED (key found in .env)"
else
  echo "AI assistant: disabled (no CURSOR_API_KEY in .env — the ask bar will return 503)"
fi

exec node src/server.js
