#!/usr/bin/env bash
# Install StoryDeck MCP server into Cursor's MCP config (one-time setup).
#
# Usage: ./tools/install-mcp.sh
#
# Installed app: uses Electron-as-Node so imports resolve from app.asar.
# Dev checkout: uses system node against this repo.

set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

APP="/Applications/StoryDeck.app"
RUNTIME_FILE="${HOME}/Library/Application Support/storydeck/runtime.json"
MCP_CONFIG="${HOME}/.cursor/mcp.json"

if [[ "$(uname)" != "Darwin" ]]; then
  RUNTIME_FILE="${APPDATA:-$HOME/AppData/Roaming}/storydeck/runtime.json"
fi

if [[ -d "$APP" ]]; then
  MODE="installed"
  MCP_SCRIPT="${APP}/Contents/Resources/app.asar/src/mcp/server.js"
  COMMAND="${APP}/Contents/MacOS/StoryDeck"
  EXTRA_ENV='{"ELECTRON_RUN_AS_NODE":"1"}'
  ARGS_JSON="[\"${MCP_SCRIPT//\"/\\\"}\"]"
else
  MODE="dev"
  COMMAND="$(command -v node)"
  MCP_SCRIPT="${REPO_ROOT}/src/mcp/server.js"
  EXTRA_ENV='{}'
  ARGS_JSON="[\"${MCP_SCRIPT//\"/\\\"}\"]"
fi

mkdir -p "$(dirname "$MCP_CONFIG")"
mkdir -p "$(dirname "$RUNTIME_FILE")"

export MCP_CONFIG COMMAND ARGS_JSON EXTRA_ENV RUNTIME_FILE MODE
node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const configPath = process.env.MCP_CONFIG;
const entry = {
  command: process.env.COMMAND,
  args: JSON.parse(process.env.ARGS_JSON),
  env: {
    ...JSON.parse(process.env.EXTRA_ENV),
    STORYDECK_RUNTIME_FILE: process.env.RUNTIME_FILE,
  },
};

let config = { mcpServers: {} };
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      config.mcpServers = {};
    }
  } catch (err) {
    console.error('Warning: could not parse existing MCP config, starting fresh:', err.message);
    config = { mcpServers: {} };
  }
}

config.mcpServers.storydeck = entry;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
console.log('Installed storydeck MCP server (' + process.env.MODE + ' mode)');
console.log('  config:', configPath);
console.log('  command:', entry.command);
console.log('  script:', entry.args[0]);
console.log('  runtime:', entry.env.STORYDECK_RUNTIME_FILE);
console.log('');
console.log('Restart Cursor, then open StoryDeck before using MCP tools.');
NODE

echo "Done. If StoryDeck is already running, quit and reopen it once after upgrading to v1.2."
