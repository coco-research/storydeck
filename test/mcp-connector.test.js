import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { SAMPLE_SEED_PATH } from '../src/db.js';
import { writeRuntimeFile } from '../src/runtime.js';
import {
  buildStorydeckMcpEntry,
  connectHarness,
  listHarnesses,
  harnessConnectionState,
  manualSnippet,
} from '../src/mcp/connector.js';
import { getHarness } from '../src/mcp/registry.js';

let server;
let base;
let tmpDir;
let runtimeFile;
let cursorConfig;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'sd-mcp-conn-'));
  runtimeFile = writeRuntimeFile(tmpDir, {
    host: '127.0.0.1',
    port: 4321,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    appVersion: '1.3.0',
  });
  cursorConfig = join(tmpDir, 'cursor-mcp.json');

  const app = createApp(':memory:', SAMPLE_SEED_PATH);
  server = app.server;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;

  process.env.STORYDECK_RUNTIME_FILE = runtimeFile;
  process.env.STORYDECK_PACKAGED = '0';
  process.env.STORYDECK_MCP_SCRIPT = join(tmpDir, 'fake-mcp-server.js');
  writeFileSync(process.env.STORYDECK_MCP_SCRIPT, '// stub');
});

after(() => {
  server.close();
  delete process.env.STORYDECK_RUNTIME_FILE;
  delete process.env.STORYDECK_PACKAGED;
  delete process.env.STORYDECK_MCP_SCRIPT;
  rmSync(tmpDir, { recursive: true, force: true });
});

test('buildStorydeckMcpEntry includes runtime file path', () => {
  const entry = buildStorydeckMcpEntry();
  assert.equal(entry.env.STORYDECK_RUNTIME_FILE, runtimeFile);
  assert.ok(Array.isArray(entry.args));
  assert.ok(entry.command);
});

test('manualSnippet returns mcpServers.storydeck', () => {
  const snip = manualSnippet();
  assert.ok(snip.mcpServers.storydeck);
});

test('connectHarness writes merged cursor config', () => {
  const harness = getHarness('cursor');
  const saved = {
    config: harness.configPath.darwin,
    apps: [...(harness.apps.darwin || [])],
  };
  const marker = join(tmpDir, 'cursor-installed.marker');
  writeFileSync(marker, '1');
  harness.configPath.darwin = cursorConfig;
  harness.apps.darwin = [marker];

  try {
    const result = connectHarness('cursor');
    assert.equal(result.ok, true);
    assert.equal(existsSync(cursorConfig), true);
    const doc = JSON.parse(readFileSync(cursorConfig, 'utf8'));
    assert.ok(doc.mcpServers.storydeck);
    assert.equal(doc.mcpServers.storydeck.env.STORYDECK_RUNTIME_FILE, runtimeFile);

    const state = harnessConnectionState(harness);
    assert.equal(state.connected, true);
    assert.equal(state.status, 'connected');
  } finally {
    harness.configPath.darwin = saved.config;
    harness.apps.darwin = saved.apps;
  }
});

test('GET /api/mcp/harnesses returns harness list', async () => {
  const res = await fetch(`${base}/api/mcp/harnesses`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.harnesses));
  assert.ok(data.harnesses.some((h) => h.id === 'cursor'));
  assert.ok(data.harnesses.some((h) => h.id === 'manual'));
});

test('POST /api/mcp/connect rejects unknown harness', async () => {
  const res = await fetch(`${base}/api/mcp/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ harnessId: 'nope' }),
  });
  assert.equal(res.status, 400);
});

test('listHarnesses includes runtimeOk when runtime file exists', () => {
  const data = listHarnesses();
  assert.equal(data.runtimeOk, true);
  assert.equal(data.runtimeFile, runtimeFile);
});
