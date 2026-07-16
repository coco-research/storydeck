import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, listStories } from '../src/db.js';
import { boardTools, TOOL_SPECS } from '../src/ai/tools.js';
import { extractJSON, runAssistant, setModelRunner } from '../src/ai/agent.js';

function freshDb() {
  return openDatabase(':memory:');
}

test('add_story creates a story with epic/points/urgent/status', () => {
  const db = freshDb();
  const tools = boardTools(db);
  const out = tools.add_story({ task: 'Chase finance on OneTrust PO', epic: 'CR07', points: 3, urgent: true, status: 'in-progress' });
  assert.ok(out.ok && out.id > 0);
  const s = out.story;
  assert.equal(s.task, 'Chase finance on OneTrust PO');
  assert.equal(s.project, 'CR07');
  assert.equal(s.points, 3);
  assert.equal(s.urgent, true);
  assert.equal(s.workStatus, 'in-progress');
});

test('add_story requires a task', () => {
  const tools = boardTools(freshDb());
  assert.throws(() => tools.add_story({ task: '   ' }), /task is required/);
});

test('update_story edits fields and validates status', () => {
  const db = freshDb();
  const tools = boardTools(db);
  const { id } = tools.add_story({ task: 'edit me' });
  const out = tools.update_story({ id, epic: 'GitHub', points: 5, urgent: true, status: 'blocked' });
  assert.equal(out.story.project, 'GitHub');
  assert.equal(out.story.points, 5);
  assert.equal(out.story.workStatus, 'blocked');
  assert.throws(() => tools.update_story({ id, status: 'nope' }), /invalid status/);
  assert.throws(() => tools.update_story({ id: 99999, task: 'x' }), /not found/);
});

test('due dates flow through add_story, update_story, and summary lines', () => {
  const db = freshDb();
  const tools = boardTools(db);
  const { id, story } = tools.add_story({ task: 'Ship it', due: '2026-08-01' });
  assert.equal(story.due, '2026-08-01');
  assert.match(tools.search_stories({ query: 'Ship it' }).results[0], /due 2026-08-01/);

  // Update the date, then clear it with an empty string.
  assert.equal(tools.update_story({ id, due: '2026-09-15' }).story.due, '2026-09-15');
  assert.equal(tools.update_story({ id, due: '' }).story.due, undefined);
});

test('get_board_summary lists open deadlines soonest-first', () => {
  const db = freshDb();
  const tools = boardTools(db);
  tools.add_story({ task: 'later', due: '2026-09-10' });
  tools.add_story({ task: 'sooner', due: '2026-08-01' });
  tools.add_story({ task: 'no date' });
  tools.add_story({ task: 'done dated', due: '2026-07-01', status: 'done' });
  const sum = tools.get_board_summary();
  assert.equal(sum.deadlines.length, 2); // done story excluded
  assert.match(sum.deadlines[0], /sooner/); // 08-01 before 09-10
  assert.match(sum.deadlines[1], /later/);
});

test('complete_story marks done', () => {
  const db = freshDb();
  const tools = boardTools(db);
  const { id } = tools.add_story({ task: 'finish me' });
  const out = tools.complete_story({ id });
  assert.equal(out.story.status, 'done');
});

test('add_comment appends a comment', () => {
  const db = freshDb();
  const tools = boardTools(db);
  const { id } = tools.add_story({ task: 'commentable' });
  const out = tools.add_comment({ id, text: 'note from AI' });
  assert.equal(out.comments, 1);
  assert.throws(() => tools.add_comment({ id, text: '' }), /required/);
});

test('search_stories matches title/epic/note/comments', () => {
  const db = freshDb();
  const tools = boardTools(db);
  tools.add_story({ task: 'Kharon invoice reconcile', epic: 'Kharon' });
  tools.add_story({ task: 'unrelated thing', epic: 'Tech' });
  const out = tools.search_stories({ query: 'kharon' });
  assert.equal(out.count, 1);
  assert.match(out.results[0], /Kharon invoice/);
});

test('get_board_summary reports counts and urgent queue', () => {
  const db = freshDb();
  const tools = boardTools(db);
  tools.add_story({ task: 'a', status: 'in-progress' });
  tools.add_story({ task: 'b urgent', urgent: true });
  tools.add_story({ task: 'c done', status: 'done' });
  const sum = tools.get_board_summary();
  assert.equal(sum.total, 3);
  assert.equal(sum.in_progress, 1);
  assert.equal(sum.done, 1);
  assert.equal(sum.urgent.length, 1);
  assert.match(sum.urgent[0], /b urgent/);
});

test('tools do NOT expose delete or reorder', () => {
  const tools = boardTools(freshDb());
  assert.equal(typeof tools.delete_story, 'undefined');
  assert.equal(typeof tools.reorder_stories, 'undefined');
  const names = TOOL_SPECS.map((t) => t.name);
  assert.ok(!names.includes('delete_story'));
});

test('extractJSON pulls a balanced object out of noisy model text', () => {
  const obj = extractJSON('sure! {"reply":"ok","actions":[]} trailing');
  assert.deepEqual(obj, { reply: 'ok', actions: [] });
  assert.equal(extractJSON('no json here'), null);
});

test('runAssistant executes a planned add_story via injected model', async () => {
  const db = freshDb();
  setModelRunner(async () => JSON.stringify({
    reply: 'added it',
    actions: [{ tool: 'add_story', args: { task: 'from the assistant', epic: 'CR07', urgent: true } }],
  }));
  try {
    const { reply, actions } = await runAssistant({ db, message: 'add a CR07 urgent story' });
    assert.equal(reply, 'added it');
    assert.equal(actions.length, 1);
    assert.ok(actions[0].ok);
    const stories = listStories(db);
    assert.ok(stories.some((s) => s.task === 'from the assistant' && s.urgent));
  } finally {
    setModelRunner(null);
  }
});

test('runAssistant ignores unsupported/delete actions', async () => {
  const db = freshDb();
  setModelRunner(async () => JSON.stringify({
    reply: 'nope',
    actions: [{ tool: 'delete_story', args: { id: 1 } }, { tool: 'reorder_stories', args: {} }],
  }));
  try {
    const { actions } = await runAssistant({ db, message: 'delete everything' });
    assert.ok(actions.every((a) => a.ok === false));
    assert.equal(listStories(db).length, 0);
  } finally {
    setModelRunner(null);
  }
});
