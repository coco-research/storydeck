import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProvider, resolveModel, PROVIDERS } from '../src/ai/providers.js';
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
