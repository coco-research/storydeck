import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { SAMPLE_SEED_PATH } from '../src/db.js';
import { writeRuntimeFile } from '../src/runtime.js';
import {
  resolveBaseUrl,
  assertLoopbackUrl,
  filterStories,
  StoryDeckNotRunningError,
} from '../src/mcp/client.js';
import {
  storydeckStatus,
  storydeckList,
  storydeckCreate,
  storydeckComplete,
  storydeckGet,
  storydeckExport,
  callTool,
} from '../src/mcp/tools.js';

let server;
let base;
let runtimeDir;
let runtimeFile;

before(async () => {
  runtimeDir = mkdtempSync(join(tmpdir(), 'sd-mcp-'));
  const app = createApp(':memory:', SAMPLE_SEED_PATH);
  server = app.server;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
  runtimeFile = writeRuntimeFile(runtimeDir, {
    host: '127.0.0.1',
    port,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    appVersion: '1.2.0',
  });
  process.env.STORYDECK_RUNTIME_FILE = runtimeFile;
  delete process.env.STORYDECK_URL;
});

after(() => {
  server.close();
  delete process.env.STORYDECK_RUNTIME_FILE;
  rmSync(runtimeDir, { recursive: true, force: true });
});

test('assertLoopbackUrl rejects public hosts', () => {
  assert.throws(() => assertLoopbackUrl('http://8.8.8.8:4321/'), /loopback/);
  assert.equal(assertLoopbackUrl('http://127.0.0.1:4321').origin, 'http://127.0.0.1:4321');
});

test('resolveBaseUrl reads runtime.json when STORYDECK_URL unset', () => {
  assert.equal(resolveBaseUrl({ runtimeFile }), base);
});

test('resolveBaseUrl prefers STORYDECK_URL override', () => {
  assert.equal(resolveBaseUrl({ baseUrl: base, runtimeFile }), base);
});

test('filterStories applies status, project, and search filters', () => {
  const stories = [
    { id: 1, task: 'Alpha', project: 'Website', status: 'pending', comments: [] },
    { id: 2, task: 'Beta', project: 'Ops', status: 'done', comments: [{ text: 'ship it' }] },
  ];
  assert.equal(filterStories(stories, { status: 'pending' }).length, 1);
  assert.equal(filterStories(stories, { project: 'ops' }).length, 1);
  assert.equal(filterStories(stories, { search: 'ship' }).length, 1);
});

test('storydeckStatus returns version and counts', async () => {
  const result = await storydeckStatus();
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.connected, true);
  assert.equal(payload.url, base);
  assert.ok(payload.counts.total >= 14);
});

test('storydeckList returns seeded stories', async () => {
  const result = await storydeckList({});
  const payload = JSON.parse(result.content[0].text);
  assert.ok(payload.count >= 14);
});

test('storydeckCreate and storydeckComplete round-trip', async () => {
  const created = await storydeckCreate({ task: 'MCP test story', project: 'Ops' });
  const story = JSON.parse(created.content[0].text);
  assert.equal(story.task, 'MCP test story');
  const done = await storydeckComplete({ id: story.id });
  const updated = JSON.parse(done.content[0].text);
  assert.equal(updated.status, 'done');
});

test('storydeckGet fetches a story by id', async () => {
  const created = await storydeckCreate({ task: 'Get me' });
  const story = JSON.parse(created.content[0].text);
  const got = await storydeckGet({ id: story.id });
  const fetched = JSON.parse(got.content[0].text);
  assert.equal(fetched.id, story.id);
});

test('storydeckExport returns stories array', async () => {
  const result = await storydeckExport();
  const payload = JSON.parse(result.content[0].text);
  assert.ok(Array.isArray(payload.stories));
});

test('callTool returns actionable error when app is not running', async () => {
  const prev = process.env.STORYDECK_URL;
  process.env.STORYDECK_URL = 'http://127.0.0.1:1';
  try {
    const result = await callTool('storydeck_status');
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not running/i);
  } finally {
    if (prev == null) delete process.env.STORYDECK_URL;
    else process.env.STORYDECK_URL = prev;
  }
});

test('callTool rejects unknown tool names', async () => {
  await assert.rejects(() => callTool('nope'), /Unknown tool/);
});
