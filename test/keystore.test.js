import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configPath, readConfig, saveConfig, applyConfigToEnv } from '../src/ai/keystore.js';
import { AIError } from '../src/ai/errors.js';

// Each test uses an isolated temp file via AI_CONFIG_PATH so nothing real is touched.
const dirs = [];
function tmpEnv(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sd-keystore-'));
  dirs.push(dir);
  return { AI_CONFIG_PATH: join(dir, 'ai-config.json'), ...extra };
}
afterEach(() => {
  while (dirs.length) {
    try { rmSync(dirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

test('configPath honors AI_CONFIG_PATH override', () => {
  const env = tmpEnv();
  assert.equal(configPath(env), env.AI_CONFIG_PATH);
});

test('configPath falls back to a file beside DB_PATH', () => {
  const p = configPath({ DB_PATH: '/tmp/some/place/todo.db' });
  assert.equal(p, '/tmp/some/place/ai-config.json');
});

test('readConfig returns {} when the file is missing', () => {
  assert.deepEqual(readConfig(tmpEnv()), {});
});

test('saveConfig writes the key, returns a key-SAFE summary, and applies to env', () => {
  const env = tmpEnv();
  const summary = saveConfig({ provider: 'openai', apiKey: 'sk-secret-123', model: 'gpt-4o' }, env);
  // Summary never echoes the key.
  assert.deepEqual(summary, { provider: 'openai', model: 'gpt-4o', keyPresent: true });
  assert.ok(!JSON.stringify(summary).includes('sk-secret-123'));
  // File persisted with the key + preference.
  assert.ok(existsSync(env.AI_CONFIG_PATH));
  const onDisk = JSON.parse(readFileSync(env.AI_CONFIG_PATH, 'utf8'));
  assert.equal(onDisk.provider, 'openai');
  assert.equal(onDisk.apiKey, 'sk-secret-123');
  // Applied into the environment so the gateway can use it immediately.
  assert.equal(env.OPENAI_API_KEY, 'sk-secret-123');
  assert.equal(env.AI_PROVIDER, 'openai');
  assert.equal(env.AI_MODEL, 'gpt-4o');
});

test('saveConfig rejects an unknown provider and an empty key', () => {
  const env = tmpEnv();
  assert.throws(() => saveConfig({ provider: 'llama', apiKey: 'k' }, env), (e) => {
    assert.ok(e instanceof AIError);
    assert.equal(e.status, 400);
    return true;
  });
  assert.throws(() => saveConfig({ provider: 'openai', apiKey: '   ' }, env), (e) => {
    assert.ok(e instanceof AIError);
    assert.equal(e.status, 400);
    return true;
  });
});

test('applyConfigToEnv fills gaps but does not clobber an existing env key', () => {
  const env = tmpEnv();
  saveConfig({ provider: 'anthropic', apiKey: 'stored-key' }, env);
  // A key already set in the real env must win.
  const env2 = { AI_CONFIG_PATH: env.AI_CONFIG_PATH, ANTHROPIC_API_KEY: 'shell-key' };
  applyConfigToEnv(env2);
  assert.equal(env2.ANTHROPIC_API_KEY, 'shell-key');
  assert.equal(env2.AI_PROVIDER, 'anthropic');
});

test('applyConfigToEnv is a no-op with no stored config', () => {
  const env = tmpEnv();
  assert.equal(applyConfigToEnv(env), false);
});
