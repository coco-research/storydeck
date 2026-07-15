// Multi-provider model gateway for the AI assistant.
//
// The public build supports three providers, chosen by AI_PROVIDER or auto-
// detected from whichever API key is present (in priority order):
//   - openai     → OPENAI_API_KEY     (Chat Completions, JSON mode)
//   - anthropic  → ANTHROPIC_API_KEY  (Messages API, Claude)
//   - cursor     → CURSOR_API_KEY     (Cursor SDK gateway)
//
// Every runner takes the single prompt string the agent builds and returns the
// raw model text; the agent extracts the STRICT-JSON action plan from it.
// Tests never reach this file — they inject a fake runner via setModelRunner().

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AIError } from './errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRATCH = join(__dirname, '..', '..', '.ai-scratch');

export const PROVIDERS = ['openai', 'anthropic', 'cursor'];

// Sensible, configurable defaults (override any of them with AI_MODEL).
const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-5',
  cursor: 'auto',
};

const KEY_FOR = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  cursor: 'CURSOR_API_KEY',
};

// Which provider + key to use. Explicit AI_PROVIDER wins; else first key found.
export function resolveProvider(env = process.env) {
  const explicit = String(env.AI_PROVIDER || '').trim().toLowerCase();
  if (explicit) {
    if (!PROVIDERS.includes(explicit)) {
      throw new AIError(`Unknown AI_PROVIDER "${explicit}". Use one of: ${PROVIDERS.join(', ')}.`, {
        disabled: true,
        status: 503,
      });
    }
    const apiKey = env[KEY_FOR[explicit]];
    if (!apiKey) {
      throw new AIError(`AI provider "${explicit}" is selected but ${KEY_FOR[explicit]} is not set.`, {
        disabled: true,
        status: 503,
      });
    }
    return { provider: explicit, apiKey };
  }
  for (const p of PROVIDERS) {
    if (env[KEY_FOR[p]]) return { provider: p, apiKey: env[KEY_FOR[p]] };
  }
  throw new AIError(
    'AI is unavailable: set one of OPENAI_API_KEY, ANTHROPIC_API_KEY, or CURSOR_API_KEY.',
    { disabled: true, status: 503 },
  );
}

export function resolveModel(provider, env = process.env) {
  const override = env.AI_MODEL && String(env.AI_MODEL).trim();
  return override || DEFAULT_MODELS[provider] || 'auto';
}

// Key-safe health snapshot for the UI. Never returns key values — only which
// providers have a key present (booleans) and the resolved active provider/model.
// Never throws: when AI is unavailable it reports enabled:false + the reason.
export function health(env = process.env) {
  const keysPresent = {};
  for (const p of PROVIDERS) keysPresent[p] = Boolean(env[KEY_FOR[p]]);
  try {
    const { provider } = resolveProvider(env);
    return {
      enabled: true,
      provider,
      model: resolveModel(provider, env),
      keysPresent,
    };
  } catch (err) {
    return {
      enabled: false,
      provider: null,
      model: null,
      keysPresent,
      reason: err && err.message ? err.message : 'AI is unavailable',
    };
  }
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}

// ── OpenAI (Chat Completions, JSON mode) ─────────────────────────────────────
async function runOpenAI(prompt, { apiKey, model }) {
  let res;
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (err) {
    throw new AIError(`OpenAI request failed: ${err.message}`, { status: 502 });
  }
  if (!res.ok) throw new AIError(`OpenAI request failed (${res.status}): ${await safeText(res)}`, { status: 502 });
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

// ── Anthropic (Messages API) ─────────────────────────────────────────────────
// Note: newer Sonnet models reject non-default temperature, so we don't send it.
async function runAnthropic(prompt, { apiKey, model }) {
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (err) {
    throw new AIError(`Anthropic request failed: ${err.message}`, { status: 502 });
  }
  if (!res.ok) throw new AIError(`Anthropic request failed (${res.status}): ${await safeText(res)}`, { status: 502 });
  const data = await res.json();
  const parts = Array.isArray(data?.content) ? data.content : [];
  return parts.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('') || '';
}

// ── Cursor SDK ───────────────────────────────────────────────────────────────
let _cachedCursorModel = null;
async function resolveCursorModel(apiKey, sdk, requested) {
  if (requested && requested !== 'auto') return requested;
  if (_cachedCursorModel) return _cachedCursorModel;
  try {
    const models = await sdk.Cursor.models.list({ apiKey });
    const ids = (models?.models || models || [])
      .map((m) => (typeof m === 'string' ? m : m.id))
      .filter(Boolean);
    const sonnet = ids.filter((id) => /sonnet/i.test(id)).sort().reverse();
    _cachedCursorModel = sonnet[0] || 'auto';
  } catch {
    _cachedCursorModel = 'auto';
  }
  return _cachedCursorModel;
}

async function runCursor(prompt, { apiKey, model }) {
  let sdk;
  try {
    sdk = await import('@cursor/sdk');
  } catch {
    throw new AIError('AI is unavailable: the @cursor/sdk package is not installed. Run `npm install @cursor/sdk`.', {
      disabled: true,
      status: 503,
    });
  }
  mkdirSync(SCRATCH, { recursive: true });
  const modelId = await resolveCursorModel(apiKey, sdk, model);
  const result = await sdk.Agent.prompt(prompt, {
    apiKey,
    model: { id: modelId },
    local: { cwd: SCRATCH },
  });
  if (result.status === 'error') {
    throw new AIError(`Model run failed: ${result.result || 'unknown error'}`, { status: 502 });
  }
  return result.result || '';
}

// Dispatch: resolve provider + model, then call the right API. Returns raw text.
export async function runViaProvider(prompt, { model } = {}, env = process.env) {
  const { provider, apiKey } = resolveProvider(env);
  const modelId = (model && String(model).trim()) || resolveModel(provider, env);
  if (provider === 'openai') return runOpenAI(prompt, { apiKey, model: modelId });
  if (provider === 'anthropic') return runAnthropic(prompt, { apiKey, model: modelId });
  return runCursor(prompt, { apiKey, model: modelId });
}
