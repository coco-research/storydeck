import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveRuntimePath,
  writeRuntimeFile,
  readRuntimeFile,
  removeRuntimeFile,
  defaultRuntimeFilePath,
  RUNTIME_FILE_NAME,
} from '../src/runtime.js';

test('resolveRuntimePath joins userData with runtime.json', () => {
  const p = resolveRuntimePath('/tmp/storydeck-user');
  assert.equal(p, join('/tmp/storydeck-user', RUNTIME_FILE_NAME));
});

test('writeRuntimeFile creates readable runtime.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sd-runtime-'));
  const file = writeRuntimeFile(dir, {
    host: '127.0.0.1',
    port: 4321,
    pid: 123,
    startedAt: '2026-07-22T00:00:00.000Z',
    appVersion: '1.2.0',
  });
  assert.equal(existsSync(file), true);
  const data = readRuntimeFile(file);
  assert.equal(data.port, 4321);
  assert.equal(data.host, '127.0.0.1');
  removeRuntimeFile(dir);
  assert.equal(existsSync(file), false);
  rmSync(dir, { recursive: true, force: true });
});

test('readRuntimeFile returns null for missing or invalid files', () => {
  assert.equal(readRuntimeFile('/no/such/runtime.json'), null);
  const dir = mkdtempSync(join(tmpdir(), 'sd-runtime-bad-'));
  const bad = join(dir, RUNTIME_FILE_NAME);
  writeFileSync(bad, JSON.stringify({ host: '127.0.0.1', port: 'nope' }));
  assert.equal(readRuntimeFile(bad), null);
  rmSync(dir, { recursive: true, force: true });
});

test('defaultRuntimeFilePath honors STORYDECK_RUNTIME_FILE', () => {
  const prev = process.env.STORYDECK_RUNTIME_FILE;
  process.env.STORYDECK_RUNTIME_FILE = '/tmp/custom-runtime.json';
  try {
    assert.equal(defaultRuntimeFilePath(), '/tmp/custom-runtime.json');
  } finally {
    if (prev == null) delete process.env.STORYDECK_RUNTIME_FILE;
    else process.env.STORYDECK_RUNTIME_FILE = prev;
  }
});
