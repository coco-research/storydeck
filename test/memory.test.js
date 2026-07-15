import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, rememberFact, recallFacts, listMemory, forgetMemory } from '../src/db.js';
import { boardTools } from '../src/ai/tools.js';
import { runAssistant, setModelRunner, buildKnownFacts } from '../src/ai/agent.js';

function db() {
  return openDatabase(':memory:');
}

test('rememberFact stores a fact and recallFacts finds it by keyword', () => {
  const d = db();
  rememberFact(d, { text: 'Kevin is my director', kind: 'entity', entity: 'Kevin' });
  rememberFact(d, { text: 'OneTrust renewal is top priority', kind: 'pin' });
  const hits = recallFacts(d, { query: 'who is kevin' });
  assert.ok(hits.some((f) => /Kevin is my director/.test(f.text)));
});

test('rememberFact de-dupes identical text and bumps weight instead of duplicating', () => {
  const d = db();
  const a = rememberFact(d, { text: 'always tag finance items CR07', kind: 'preference' });
  const b = rememberFact(d, { text: 'always tag finance items CR07', kind: 'preference' });
  assert.equal(a.id, b.id);
  assert.ok(b.weight > a.weight);
  assert.equal(listMemory(d).length, 1);
});

test('recallFacts with no query returns pins first', () => {
  const d = db();
  rememberFact(d, { text: 'random fact', kind: 'fact' });
  rememberFact(d, { text: 'pinned thing', kind: 'pin' });
  const top = recallFacts(d, { query: '' });
  assert.equal(top[0].text, 'pinned thing');
});

test('recall reinforces weight so useful facts stick', () => {
  const d = db();
  rememberFact(d, { text: 'budget doc is this week #1', kind: 'fact' });
  const before = listMemory(d)[0].weight;
  recallFacts(d, { query: 'budget' });
  const after = listMemory(d)[0].weight;
  assert.ok(after > before);
});

test('forgetMemory removes a row', () => {
  const d = db();
  const row = rememberFact(d, { text: 'temporary note', kind: 'fact' });
  assert.equal(forgetMemory(d, row.id), true);
  assert.equal(listMemory(d).length, 0);
});

test('boardTools.remember validates and stores; recall returns texts', () => {
  const d = db();
  const t = boardTools(d);
  assert.throws(() => t.remember({ text: '' }), /text is required/);
  const res = t.remember({ text: 'Leo handles Okta integration', kind: 'entity', entity: 'Leo' });
  assert.equal(res.ok, true);
  const recalled = t.recall({ query: 'okta' });
  assert.ok(recalled.facts.some((f) => /Leo handles Okta/.test(f)));
});

test('buildKnownFacts injects a block once facts exist', () => {
  const d = db();
  assert.equal(buildKnownFacts(d, 'anything'), '');
  rememberFact(d, { text: 'vendor renewals need a PO first', kind: 'preference' });
  const block = buildKnownFacts(d, 'renewal');
  assert.match(block, /KNOWN FACTS/);
  assert.match(block, /vendor renewals need a PO first/);
});

test('runAssistant executes a remember action and it persists', async () => {
  const d = db();
  setModelRunner(async () => JSON.stringify({
    reply: 'Got it — I will remember that.',
    actions: [{ tool: 'remember', args: { text: 'standups are Monday 9am', kind: 'fact' } }],
  }));
  const out = await runAssistant({ db: d, message: 'remember standups are Monday 9am' });
  setModelRunner(null);
  assert.ok(out.actions.some((a) => a.tool === 'remember' && a.ok));
  assert.ok(recallFacts(d, { query: 'standup' }).some((f) => /Monday 9am/.test(f.text)));
});
