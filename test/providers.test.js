import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProvider, resolveModel, PROVIDERS, health } from '../src/ai/providers.js';
import { AIError } from '../src/ai/errors.js';

test('auto-detects provider from whichever key is present (priority order)', () => {
  assert.equal(resolveProvider({ OPENAI_API_KEY: 'k' }).provider, 'openai');
  assert.equal(resolveProvider({ ANTHROPIC_API_KEY: 'k' }).provider, 'anthropic');
  assert.equal(resolveProvider({ CURSOR_API_KEY: 'k' }).provider, 'cursor');
  // OpenAI wins when several keys are present.
  const both = resolveProvider({ OPENAI_API_KEY: 'a', ANTHROPIC_API_KEY: 'b', CURSOR_API_KEY: 'c' });
  assert.equal(both.provider, 'openai');
  assert.equal(both.apiKey, 'a');
});

test('explicit AI_PROVIDER is honored and returns its key', () => {
  const r = resolveProvider({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sekret', OPENAI_API_KEY: 'x' });
  assert.equal(r.provider, 'anthropic');
  assert.equal(r.apiKey, 'sekret');
});

test('explicit provider without its key throws a disabled AIError', () => {
  assert.throws(() => resolveProvider({ AI_PROVIDER: 'openai' }), (err) => {
    assert.ok(err instanceof AIError);
    assert.equal(err.disabled, true);
    assert.equal(err.status, 503);
    return true;
  });
});

test('unknown AI_PROVIDER throws', () => {
  assert.throws(() => resolveProvider({ AI_PROVIDER: 'llama', OPENAI_API_KEY: 'k' }), /Unknown AI_PROVIDER/);
});

test('no keys at all throws a disabled AIError', () => {
  assert.throws(() => resolveProvider({}), (err) => {
    assert.ok(err instanceof AIError);
    assert.equal(err.disabled, true);
    assert.equal(err.status, 503);
    return true;
  });
});

test('resolveModel: AI_MODEL overrides, else a sensible per-provider default', () => {
  assert.equal(resolveModel('openai', {}), 'gpt-4o-mini');
  assert.equal(resolveModel('anthropic', {}), 'claude-sonnet-5');
  assert.equal(resolveModel('cursor', {}), 'auto');
  assert.equal(resolveModel('openai', { AI_MODEL: 'gpt-4o' }), 'gpt-4o');
  assert.equal(resolveModel('anthropic', { AI_MODEL: 'claude-opus-4-8' }), 'claude-opus-4-8');
});

test('PROVIDERS lists the three supported providers', () => {
  assert.deepEqual(PROVIDERS, ['openai', 'anthropic', 'cursor']);
});

test('health: reports enabled + active provider/model when a key is present', () => {
  const h = health({ ANTHROPIC_API_KEY: 'k' });
  assert.equal(h.enabled, true);
  assert.equal(h.provider, 'anthropic');
  assert.equal(h.model, 'claude-sonnet-5');
  assert.deepEqual(h.keysPresent, { openai: false, anthropic: true, cursor: false });
});

test('health: honors AI_PROVIDER + AI_MODEL', () => {
  const h = health({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k', AI_MODEL: 'gpt-4o' });
  assert.equal(h.enabled, true);
  assert.equal(h.provider, 'openai');
  assert.equal(h.model, 'gpt-4o');
});

test('health: disabled with a reason when no keys are set (never throws)', () => {
  const h = health({});
  assert.equal(h.enabled, false);
  assert.equal(h.provider, null);
  assert.equal(h.model, null);
  assert.deepEqual(h.keysPresent, { openai: false, anthropic: false, cursor: false });
  assert.match(h.reason, /AI is unavailable/);
});

test('health: never leaks key values, only presence booleans', () => {
  const h = health({ OPENAI_API_KEY: 'super-secret-value' });
  const serialized = JSON.stringify(h);
  assert.ok(!serialized.includes('super-secret-value'));
  assert.equal(h.keysPresent.openai, true);
});
