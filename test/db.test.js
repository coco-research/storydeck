import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openDatabase,
  seedIfEmpty,
  listStories,
  getStory,
  createStory,
  updateStory,
  deleteStory,
  reorderStories,
  addComment,
  replaceAll,
  getMeta,
  SAMPLE_SEED_PATH,
} from '../src/db.js';

// Tests run against the committed PUBLIC sample seed so they are deterministic
// and pass in a clean clone — never against the private on-device seed.json.
function freshSeededDb() {
  const db = openDatabase(':memory:');
  seedIfEmpty(db, SAMPLE_SEED_PATH);
  return db;
}

test('sample seed loads all stories exactly once', () => {
  const db = freshSeededDb();
  assert.equal(listStories(db).length, 14);
  assert.equal(getMeta(db, 'seeded'), 'true');
  // Idempotent: a second call must not duplicate.
  const again = seedIfEmpty(db, SAMPLE_SEED_PATH);
  assert.equal(again.seeded, false);
  assert.equal(listStories(db).length, 14);
});

test('due date round-trips on create, patch, and clears when done', () => {
  const db = openDatabase(':memory:');
  const s = createStory(db, { task: 'Ship v2', due: '2026-08-01' });
  assert.equal(s.due, '2026-08-01');

  // A garbage due value is normalized away (no due field on the story).
  const bad = createStory(db, { task: 'No date', due: 'soon-ish' });
  assert.equal(bad.due, undefined);

  // Patch updates the date; empty string clears it.
  assert.equal(updateStory(db, s.id, { due: '2026-09-15' }).due, '2026-09-15');
  assert.equal(updateStory(db, s.id, { due: '' }).due, undefined);

  // Completing a story preserves the stored due date (the UI hides it when
  // done, but the data survives a reopen — no destructive side effects).
  const dated = createStory(db, { task: 'Dated', due: '2026-08-01' });
  assert.equal(updateStory(db, dated.id, { status: 'done' }).due, '2026-08-01');
});

test('opened database exposes the due column (schema + migrate)', () => {
  const db = openDatabase(':memory:');
  const cols = db.prepare('PRAGMA table_info(stories)').all().map((c) => c.name);
  assert.ok(cols.includes('due'), 'due column present after openDatabase');
});

test('seeded data preserves epics, done count, and comments', () => {
  const db = freshSeededDb();
  const stories = listStories(db);
  const done = stories.filter((s) => s.status === 'done');
  assert.equal(done.length, 3);

  const epics = new Set(stories.map((s) => s.project || 'Unassigned'));
  ['Website', 'Mobile', 'GitHub', 'Personal'].forEach((e) => assert.ok(epics.has(e), `missing epic ${e}`));

  // The Ops invoice story carries a comment in the sample seed.
  const invoice = stories.find((s) => s.task.startsWith('Vendor invoice'));
  assert.ok(invoice);
  assert.equal(invoice.comments.length, 1);
  assert.match(invoice.comments[0].text, /new po request/);
});

test('createStory assigns a DB id and appears in list', () => {
  const db = freshSeededDb();
  const before = listStories(db).length;
  const story = createStory(db, { task: 'New test story', project: 'Tech', points: 3, urgent: true });
  assert.ok(story.id > 0);
  assert.equal(story.project, 'Tech');
  assert.equal(story.points, 3);
  assert.equal(story.urgent, true);
  assert.equal(listStories(db).length, before + 1);
});

test('createStory rejects empty task', () => {
  const db = freshSeededDb();
  assert.throws(() => createStory(db, { task: '   ' }), /task is required/);
});

test('updateStory changes fields and keeps status consistent', () => {
  const db = freshSeededDb();
  const s = createStory(db, { task: 'edit me', project: 'Tech' });
  const done = updateStory(db, s.id, { status: 'done' });
  assert.equal(done.status, 'done');
  assert.ok(done.completed, 'completed date set when done');
  assert.equal(done.workStatus, undefined, 'workStatus cleared when done');

  const back = updateStory(db, s.id, { status: 'pending', workStatus: 'in-progress' });
  assert.equal(back.status, 'pending');
  assert.equal(back.completed, undefined, 'completed cleared when reopened');
  assert.equal(back.workStatus, 'in-progress');
});

test('Unassigned epic is stored as empty string', () => {
  const db = freshSeededDb();
  const s = createStory(db, { task: 'no epic', project: 'Unassigned' });
  assert.equal(s.project, '');
  const s2 = updateStory(db, s.id, { project: 'Unassigned' });
  assert.equal(s2.project, '');
});

test('deleteStory removes it and cascades comments', () => {
  const db = freshSeededDb();
  const s = createStory(db, { task: 'temp' });
  addComment(db, s.id, 'a comment');
  assert.equal(getStory(db, s.id).comments.length, 1);
  assert.equal(deleteStory(db, s.id), true);
  assert.equal(getStory(db, s.id), null);
  // Comment rows cascade-deleted.
  const orphan = db.prepare('SELECT COUNT(*) AS n FROM comments WHERE story_id = ?').get(s.id);
  assert.equal(orphan.n, 0);
});

test('addComment appends and returns the updated story', () => {
  const db = freshSeededDb();
  const s = createStory(db, { task: 'commentable' });
  const updated = addComment(db, s.id, 'first');
  assert.equal(updated.comments.length, 1);
  addComment(db, s.id, 'second');
  assert.equal(getStory(db, s.id).comments.length, 2);
  assert.equal(getStory(db, s.id).comments[1].text, 'second');
});

test('addComment rejects empty text', () => {
  const db = freshSeededDb();
  const s = createStory(db, { task: 'x' });
  assert.throws(() => addComment(db, s.id, '   '), /required/);
});

test('reorderStories persists new within-column order', () => {
  const db = freshSeededDb();
  const a = createStory(db, { task: 'A', workStatus: 'in-progress' });
  const b = createStory(db, { task: 'B', workStatus: 'in-progress' });
  const c = createStory(db, { task: 'C', workStatus: 'in-progress' });
  // Reorder to C, A, B.
  reorderStories(db, [c.id, a.id, b.id]);
  const inProgress = listStories(db)
    .filter((s) => s.workStatus === 'in-progress' && ['A', 'B', 'C'].includes(s.task))
    .map((s) => s.task);
  assert.deepEqual(inProgress, ['C', 'A', 'B']);
});

test('replaceAll wipes and reloads transactionally', () => {
  const db = freshSeededDb();
  const result = replaceAll(db, [
    { task: 'only one', project: 'Solo', points: 5, status: 'pending' },
  ]);
  assert.equal(result.length, 1);
  assert.equal(listStories(db).length, 1);
  assert.equal(listStories(db)[0].task, 'only one');
});
