#!/bin/bash
# Capture prod (localhost) and preview (file) across key views for visual comparison.
set -u
cd "$(dirname "$0")/.."
mkdir -p screenshots
E=node_modules/.bin/electron
PROD="${PROD_URL:-http://127.0.0.1:4321/}"
PREV="file://$(pwd)/retro-preview.html"

shoot() { # url out view theme [density] [ai]
  SHOT_URL="$1" SHOT_OUT="$2" SHOT_VIEW="$3" SHOT_THEME="$4" SHOT_DENSITY="${5:-}" SHOT_AI="${6:-}" "$E" tools/shot.cjs 2>/dev/null
}

shoot "$PROD" screenshots/prod-board.png    board gruvbox
shoot "$PROD" screenshots/prod-list.png     board gruvbox compact
shoot "$PROD" screenshots/prod-dash.png     dash  gruvbox
shoot "$PROD" screenshots/prod-ai.png       board gruvbox comfortable 1
shoot "$PREV" screenshots/preview-board.png board gruvbox
shoot "$PREV" screenshots/preview-list.png  list  gruvbox
shoot "$PREV" screenshots/preview-dash.png  dash  gruvbox

echo "shots done:"
ls -la screenshots/*.png 2>/dev/null | awk '{print $9, $5}'
