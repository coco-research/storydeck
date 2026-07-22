#!/usr/bin/env bash
# Verify StoryDeck v1.2 is installed, running, and reporting correctly.
set -euo pipefail
APP="/Applications/StoryDeck.app"
BUNDLE_VER="$(defaults read "${APP}/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo missing)"
API_JSON="$(curl -sf http://127.0.0.1:4321/api/version 2>/dev/null || echo '{}')"
API_VER="$(node -e "const d=JSON.parse(process.argv[1]); console.log(d.appVersion||'down')" "$API_JSON")"
RUNTIME="${HOME}/Library/Application Support/storydeck/runtime.json"
RUNTIME_OK="no"
[ -f "$RUNTIME" ] && RUNTIME_OK="yes"
MCP_OK="no"
[ -f "${HOME}/.cursor/mcp.json" ] && node -e "const c=require('${HOME}/.cursor/mcp.json'); process.exit(c.mcpServers&&c.mcpServers.storydeck?0:1)" 2>/dev/null && MCP_OK="yes" || true
READY="no"
if [[ "$BUNDLE_VER" == 1.2.* && "$API_VER" == 1.2.* && "$RUNTIME_OK" == "yes" ]]; then READY="yes"; fi
echo "bundle=${BUNDLE_VER} api=${API_VER} runtime=${RUNTIME_OK} mcp=${MCP_OK} ready=${READY}"
