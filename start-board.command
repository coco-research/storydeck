#!/bin/bash
# Double-click launcher for Rijul's Stories — opens the native desktop app.
# The board's local SQLite server runs *inside* Electron (on-device only).
cd "$(dirname "$0")" || exit 1

# Free a stale port from a previous run, if any.
if command -v lsof >/dev/null 2>&1; then
  lsof -ti tcp:"${PORT:-4321}" 2>/dev/null | xargs kill -9 2>/dev/null
fi

if [ -x "./node_modules/.bin/electron" ]; then
  echo "Opening Rijul's Stories…"
  exec ./node_modules/.bin/electron .
else
  echo "Electron isn't installed. Run 'npm install' in this folder first,"
  echo "or fall back to the browser version with:  npm start"
  echo "(then open http://127.0.0.1:4321)"
  read -r -p "Press Return to close."
fi
