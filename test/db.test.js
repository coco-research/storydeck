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
} from '../src/db.js';

function freshSeededDb() {
  const db = openDatabase(':memory:');
  seedIfEmpty(db);
  return db;
}

test('seed loads all 71 stories exactly once', () => {
  const db = freshSeededDb();
  assert.equal(listStories(db).length, 71);
  assert.equal(getMeta(db, 'seeded'), 'true');
  // Idempotent: a second call must not duplicate.
  const again = seedIfEmpty(db);
  assert.equal(again.seeded, false);
  assert.equal(listStories(db).length, 71);
});

test('seeded data preserves epics, done count, and comments', () => {
  const db = freshSeededDb();
  const stories = listStories(db);
  const done = stories.filter((s) => s.status === 'done');
  assert.equal(done.length, 16);

  const epics = new Set(stories.map((s) => s.project || 'Unassigned'));
  ['Coco', 'CR07', 'Kharon', 'AB1', 'GitHub'].forEach((e) => assert.ok(epics.has(e), `missing epic ${e}`));

  // Story 5 (Kharon) has a comment in the seed.
  const kharon = stories.find((s) => s.task.startsWith('Kharon invoice'));
  assert.ok(kharon);
  assert.equal(kharon.comments.length, 1);
  assert.match(kharon.comments[0].text, /new po request/);
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
