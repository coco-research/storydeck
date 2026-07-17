import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sha256,
  isNewer,
  readManifest,
  isAllowedRelPath,
  chooseContentSource,
  readOverlayMeta,
  markBootOk,
  downloadUpdate,
} from '../src/updater.js';

function tmp() { return mkdtempSync(join(tmpdir(), 'sd-upd-')); }

// Seed a valid overlay dir with a given version/failcount.
function seedOverlay(userDataDir, { version, failcount = 0 } = {}) {
  const oDir = join(userDataDir, 'content-overlay');
  mkdirSync(join(oDir, 'web'), { recursive: true });
  mkdirSync(join(oDir, 'src'), { recursive: true });
  writeFileSync(join(oDir, 'web', 'index.html'), '<!-- overlay -->');
  writeFileSync(join(oDir, 'src', 'server.js'), '// overlay');
  writeFileSync(join(oDir, '.meta.json'), JSON.stringify({ version, failcount }));
  return oDir;
}

test('isNewer compares content versions numerically', () => {
  assert.equal(isNewer(2, 1), true);
  assert.equal(isNewer(1, 1), false);
  assert.equal(isNewer(1, 2), false);
  assert.equal(isNewer(5, undefined), true);
});

test('isAllowedRelPath permits only web/ and src/ relative paths', () => {
  assert.equal(isAllowedRelPath('web/index.html'), true);
  assert.equal(isAllowedRelPath('src/ai/agent.js'), true);
  assert.equal(isAllowedRelPath('../etc/passwd'), false);
  assert.equal(isAllowedRelPath('/etc/passwd'), false);
  assert.equal(isAllowedRelPath('src/../../x'), false);
  assert.equal(isAllowedRelPath('main.js'), false);
  assert.equal(isAllowedRelPath('web/'), false);
  assert.equal(isAllowedRelPath(''), false);
});

test('readManifest parses valid and rejects malformed', () => {
  const dir = tmp();
  const good = join(dir, 'm.json');
  writeFileSync(good, JSON.stringify({ contentVersion: 3, files: { 'web/x': 'abc' } }));
  assert.equal(readManifest(good).contentVersion, 3);
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{not json');
  assert.equal(readManifest(bad), null);
  writeFileSync(bad, JSON.stringify({ nope: true }));
  assert.equal(readManifest(bad), null);
});

test('chooseContentSource falls back to bundled when no overlay', () => {
  const dir = tmp();
  const s = chooseContentSource({ bundledDir: '/bundle', userDataDir: dir, bundledVersion: 5 });
  assert.equal(s.fromOverlay, false);
  assert.equal(s.dir, '/bundle');
});

test('chooseContentSource ignores an overlay that is not newer than bundled', () => {
  const dir = tmp();
  seedOverlay(dir, { version: 4 });
  const s = chooseContentSource({ bundledDir: '/bundle', userDataDir: dir, bundledVersion: 10 });
  assert.equal(s.fromOverlay, false);
});

test('chooseContentSource uses a newer overlay and records a boot attempt', () => {
  const dir = tmp();
  seedOverlay(dir, { version: 20, failcount: 0 });
  const s = chooseContentSource({ bundledDir: '/bundle', userDataDir: dir, bundledVersion: 10 });
  assert.equal(s.fromOverlay, true);
  assert.equal(s.version, 20);
  // failcount incremented (cleared later by markBootOk)
  assert.equal(readOverlayMeta(dir).failcount, 1);
});

test('chooseContentSource rolls back after repeated boot failures', () => {
  const dir = tmp();
  seedOverlay(dir, { version: 20, failcount: 2 });
  const s = chooseContentSource({ bundledDir: '/bundle', userDataDir: dir, bundledVersion: 10, maxFailures: 2 });
  assert.equal(s.fromOverlay, false, 'should roll back to bundled after 2 failures');
});

test('markBootOk clears the boot-failure counter', () => {
  const dir = tmp();
  seedOverlay(dir, { version: 20, failcount: 1 });
  markBootOk(dir);
  assert.equal(readOverlayMeta(dir).failcount, 0);
});

test('downloadUpdate applies a newer, SHA-verified overlay atomically', async () => {
  const dir = tmp();
  const remote = {
    'web/index.html': '<!-- v99 -->',
    'src/server.js': '// v99 server',
  };
  const manifest = {
    contentVersion: 99,
    files: Object.fromEntries(Object.entries(remote).map(([k, v]) => [k, sha256(Buffer.from(v))])),
  };
  const fetchImpl = async (url) => {
    if (url.endsWith('content-manifest.json')) return Buffer.from(JSON.stringify(manifest));
    for (const [rel, body] of Object.entries(remote)) if (url.endsWith('/' + rel)) return Buffer.from(body);
    throw new Error('unexpected url ' + url);
  };
  const r = await downloadUpdate({ userDataDir: dir, currentVersion: 1, fetchImpl });
  assert.equal(r.updated, true);
  assert.equal(r.version, 99);
  assert.equal(readFileSync(join(dir, 'content-overlay', 'web', 'index.html'), 'utf8'), '<!-- v99 -->');
  assert.equal(readOverlayMeta(dir).version, 99);
  assert.equal(readOverlayMeta(dir).failcount, 0);
});

test('downloadUpdate is a no-op when already up to date', async () => {
  const dir = tmp();
  const manifest = { contentVersion: 5, files: {} };
  const fetchImpl = async () => Buffer.from(JSON.stringify(manifest));
  const r = await downloadUpdate({ userDataDir: dir, currentVersion: 10, fetchImpl });
  assert.equal(r.updated, false);
  assert.equal(r.reason, 'up-to-date');
});

test('downloadUpdate rejects a SHA mismatch and leaves no overlay', async () => {
  const dir = tmp();
  const manifest = { contentVersion: 50, files: { 'web/index.html': 'deadbeef' } };
  const fetchImpl = async (url) =>
    url.endsWith('content-manifest.json') ? Buffer.from(JSON.stringify(manifest)) : Buffer.from('tampered');
  const r = await downloadUpdate({ userDataDir: dir, currentVersion: 1, fetchImpl });
  assert.equal(r.updated, false);
  assert.match(r.reason, /sha-mismatch/);
  assert.equal(existsSync(join(dir, 'content-overlay', 'web', 'index.html')), false);
});

test('downloadUpdate refuses a manifest with a disallowed path', async () => {
  const dir = tmp();
  const manifest = { contentVersion: 50, files: { '../evil.js': 'abc' } };
  const fetchImpl = async () => Buffer.from(JSON.stringify(manifest));
  const r = await downloadUpdate({ userDataDir: dir, currentVersion: 1, fetchImpl });
  assert.equal(r.updated, false);
  assert.match(r.reason, /disallowed-path/);
});
